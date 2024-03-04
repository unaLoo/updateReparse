import mapboxgl from 'mapbox-gl'
import * as Scratch from './scratch/scratch.js'
import { mat4 } from 'gl-matrix'
import axios from 'axios'
import libtess from 'libtess'
import earcut from 'earcut'

/*global libtess */
var tessy = (function initTesselator() {
// function called for each vertex of tesselator output
function vertexCallback(data, polyVertArray) {

    const coords = mapboxgl.MercatorCoordinate.fromLngLat([data[0], data[1]])
    polyVertArray[polyVertArray.length] = coords.x;
    polyVertArray[polyVertArray.length] = coords.y;
}
function begincallback(type) {
    if (type !== libtess.primitiveType.GL_TRIANGLES) {
        console.log('expected TRIANGLES but got type: ' + type);
    }
}
function errorcallback(errno) {
    console.log('error callback');
    console.log('error number: ' + errno);
}
// callback for when segments intersect and must be split
function combinecallback(coords, data, weight) {
    // console.log('combine callback');
    return [coords[0], coords[1], coords[2]];
}
function edgeCallback(flag) {
    // don't really care about the flag, but need no-strip/no-fan behavior
    // console.log('edge flag: ' + flag);
}

var tessy = new libtess.GluTesselator();
// tessy.gluTessProperty(libtess.gluEnum.GLU_TESS_WINDING_RULE, libtess.windingRule.GLU_TESS_WINDING_POSITIVE);
tessy.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX_DATA, vertexCallback);
tessy.gluTessCallback(libtess.gluEnum.GLU_TESS_BEGIN, begincallback);
tessy.gluTessCallback(libtess.gluEnum.GLU_TESS_ERROR, errorcallback);
tessy.gluTessCallback(libtess.gluEnum.GLU_TESS_COMBINE, combinecallback);
tessy.gluTessCallback(libtess.gluEnum.GLU_TESS_EDGE_FLAG, edgeCallback);

return tessy;
})();

/**
 * @typedef {object} MapOptions
 * @property {BoundingBox2D} cameraBounds
 * @property {Array[number]} cameraPos
 * @property {number} zoomLevel
 */

class BoundingBox2D {
    
    constructor(boundary) {

        if (boundary) this.boundary = boundary
        else this.boundary = [
            Infinity,
            Infinity,
            -Infinity,
            -Infinity,
        ]
    }

    static create(boundary) {

        if (boundary && boundary.length == 4) return new BoundingBox2D(boundary)
        else return new BoundingBox2D()
    }

    update(x, y) {
        
        this.boundary[0] = x < this.boundary[0] ? x : this.boundary[0]
        this.boundary[1] = y < this.boundary[1] ? y : this.boundary[1]
        this.boundary[2] = x > this.boundary[2] ? x : this.boundary[2]
        this.boundary[3] = y > this.boundary[3] ? y : this.boundary[3]
    }

    updateByBox(box) {
        
        this.update(box.boundary[0], box.boundary[1])
        this.update(box.boundary[2], box.boundary[3])
    }

    /**
     * 
     * @param {BoundingBox2D} bBox 
     */
    overlap(bBox) {

        if (this.boundary[0] > bBox.boundary[2] || this.boundary[2] < bBox.boundary[0]) return false
        if (this.boundary[1] > bBox.boundary[3] || this.boundary[3] < bBox.boundary[1]) return false

        return true
    }

    center() {

        return [
            (this.boundary[0] + this.boundary[2]) / 2,
            (this.boundary[1] + this.boundary[3]) / 2,
        ]
    }

    size() {
        
        return [
            this.boundary[2] - this.boundary[0],
            this.boundary[3] - this.boundary[1],
        ]
    }

    reset() {

        this.boundary = [
            Infinity,
            Infinity,
            -Infinity,
            -Infinity,
        ]
    }

    release() {

        this.boundary = null
        return null
    }
}

class TerrainNode2D {

    /**
     * @param {number} level 
     * @param {number} id 
     * @param {TerrainNode2D} [parent]
     */
    constructor(level = 0, id = 0, parent = undefined) {

        this.parent = parent
        this.level = level
        this.id = id

        this.size = 180.0 / Math.pow(2, level)

        const subId = this.id % 4
        const minLon = (this.parent ? this.parent.bBox.boundary[0] : 0.0) + (subId % 2) * this.size
        const maxLon = minLon + this.size
        const minLat = (this.parent ? this.parent.bBox.boundary[1] : -90.0) + Math.floor((subId / 2)) * this.size
        const maxLat = minLat + this.size

        this.bBox = BoundingBox2D.create([
            minLon, minLat,
            maxLon, maxLat,
        ])

        /**
         * @type {TerrainNode2D[]}
         */
        this.children = []
    }

    release() {
        
        this.bBox = this.bBox.release()
        this.children = null
        this.parent = null
        this.level = null
        this.size = null
        this.id = null
    }

    /**
     * @param {MapOptions} options
     * @returns 
     */
    isSubdividable(options) {

        // if (!this.bBox.overlap(options.cameraBounds)) return false

        const center = this.bBox.center()

        const hFactor = Math.ceil(Math.abs(center[0] - options.cameraPos[0]) / this.size)
        const vFactor = Math.ceil(Math.abs(center[1] - options.cameraPos[1]) / this.size)
        const distance = Math.max(hFactor, vFactor)
        if (distance <= 3) return true
        else return false
    }
}

class TerrainTile {

    constructor(maxLevel) {

        this.maxLevel = maxLevel
        this.maxVisibleNodeLevel = 0
        this.minVisibleNodeLevel = this.maxLevel
        this.maxBindingUsedNum = 5000

        this.tileBox = new BoundingBox2D()
        this.sectorSize = []

        this.nodeLevelArray = Scratch.aRef(new Uint32Array(this.maxBindingUsedNum), 'Storage (Node level)')
        nodeLevelBuffer = Scratch.StorageBuffer.create({
            name: 'Storage Buffer (Node level)',
            resource: { arrayRef: this.nodeLevelArray }
        }).use()
        this.nodeBoxArray = Scratch.aRef(new Float32Array(this.maxBindingUsedNum * 4), 'Storage (Node bBox)')
        nodeBoxBuffer = Scratch.StorageBuffer.create({
            name: 'Storage Buffer (Node bBox)',
            resource: { arrayRef: this.nodeBoxArray }
        }).use()

        this.stack = []

        this.bindingUsed = 0
        this.lodMapBinding = Scratch.Binding.create({
            name: `Binding (Terrain node)`,
            range: () => [4, this.bindingUsed],
            sharedUniforms: [
                { buffer: gStaticBuffer },
            ],
            uniforms: [
                {
                    name: 'tileUniform',
                    dynamic: true,
                    map: {
                        tileBox: () => this.tileBox.boundary,
                        levelRange: () => [this.minVisibleNodeLevel, this.maxVisibleNodeLevel],
                        sectorSize: () => this.sectorSize
                    }
                }
            ],
            storages: [
                { buffer: nodeLevelBuffer },
                { buffer: nodeBoxBuffer },
            ],
        })
        this.meshBinding = Scratch.Binding.create({
            name: `Binding (Terrain node)`,
            range: () => [indexNum / 3 * (this.asLine ? 6 : 3), this.bindingUsed],
            uniforms: [
                {
                    name: 'tileUniform',
                    dynamic: true,
                    map: {
                        tileBox: () => this.tileBox.boundary,
                        levelRange: () => [this.minVisibleNodeLevel, this.maxVisibleNodeLevel],
                        sectorSize: () => this.sectorSize
                    }
                }
            ],
            sharedUniforms: [
                { buffer: gStaticBuffer },
                { buffer: gDynamicBuffer }
            ],
            samplers: [ lSamplerDesc ],
            textures: [
                { texture: demTexture },
                { texture: borderTexture },
                { texture: lodMapTexture },
                { texture: paletteTexture },
            ],
            storages: [
                { buffer: indexBuffer },
                { buffer: positionBuffer },
                { buffer: nodeLevelBuffer },
                { buffer: nodeBoxBuffer },
            ],
        })

        this.asLine = 0
        this.lodMapPipeline = Scratch.RenderPipeline.create({
            name: 'Render Pipeline (LOD Map)',
            shader: Scratch.shaderLoader.load('Shader (Terrain Mesh)', '/shaders/lodMap.wgsl'),
            primitive: { topology: 'triangle-strip' },
        })
        this.meshRenderPipeline = Scratch.RenderPipeline.create({
            name: 'Render Pipeline (Terrain Mesh)',
            shader: Scratch.shaderLoader.load('Shader (Terrain Mesh)', '/shaders/terrainMesh.wgsl'),
            colorTargetStates: [ { blend: Scratch.NoBlending } ],
            depthTest: true,
        })
        this.meshLineRenderPipeline = Scratch.RenderPipeline.create({
            name: 'Render Pipeline (Terrain Mesh)',
            shader: Scratch.shaderLoader.load('Shader (Terrain Mesh)', '/shaders/terrainMeshLine.wgsl'),
            depthTest: true,
            primitive: { topology: 'line-list' },
        })

        lodMapPass.add(this.lodMapPipeline, this.lodMapBinding)
        meshRenderPass.add(this.asLine ? this.meshLineRenderPipeline : this.meshRenderPipeline, this.meshBinding)
    }

    /**
     * @param {MapOptions} options 
     */
    registerRenderableNode(options) {
        
        this.tileBox.reset()
        this.sectorSize = []
        this.bindingUsed = 0
        this.maxVisibleNodeLevel = 0
        this.minVisibleNodeLevel = this.maxLevel

        this.stack.push(new TerrainNode2D(0, 0))
        const visibleNode = []
        while(this.stack.length > 0) {
            
            let node = this.stack.pop()
            if (!node.bBox.overlap(boundaryCondition)) continue

            if (!node.isSubdividable(options) || node.level >= this.maxLevel || node.level >= options.zoomLevel) {
                
                visibleNode.push(node)
                if (node.level > this.maxVisibleNodeLevel) {

                    this.sectorSize = node.bBox.size()
                    this.maxVisibleNodeLevel = node.level
                }
                continue
            }

            for (let i = 0; i < 4; i++) {

                if (!node.children[i]) node.children[i] = new TerrainNode2D(node.level + 1, 4 * node.id + i, node)
                this.stack.push(node.children[i])
            }
        }

        visibleNode.sort((a, b) => a.level - b.level).forEach(node => {

            if (this.bindingUsed >= this.maxBindingUsedNum || node.level + 5 < this.maxVisibleNodeLevel) return

            this.minVisibleNodeLevel = node.level < this.minVisibleNodeLevel ? node.level : this.minVisibleNodeLevel
            this.tileBox.updateByBox(node.bBox)

            this.nodeLevelArray.elements(this.bindingUsed, node.level)
            this.nodeBoxArray.elements(this.bindingUsed * 4 + 0, node.bBox.boundary[0])
            this.nodeBoxArray.elements(this.bindingUsed * 4 + 1, node.bBox.boundary[1])
            this.nodeBoxArray.elements(this.bindingUsed * 4 + 2, node.bBox.boundary[2])
            this.nodeBoxArray.elements(this.bindingUsed * 4 + 3, node.bBox.boundary[3])

            this.bindingUsed++
            node.release()
        })

        // console.log((this.tileBox.boundary[2] - this.tileBox.boundary[0]) / this.sectorSize[0])
        // console.log(this.tileBox.boundary)
        // console.log(this.minVisibleNodeLevel, this.maxVisibleNodeLevel, this.bindingUsed)
    }
}

function grid(c = 200, r = 200) {

    const col = c + 1
    const row = r + 1
    const positions = []
    const uvs = []
    let rowStep = 1.0 / r
    let colStep = 1.0 / c
    let x = 0.0, y = 0.0
    for (let i = 0; i < row; i++) {
        x = 0.0
        for (let j = 0; j < col; j++) {
            positions.push(x)
            positions.push(y)
            uvs.push(j / col)
            uvs.push(1.0 - i / row)
            x += colStep
        }
        y += rowStep
    }

    const indices = []
    for (let i = 0; i < r; i++) {
        for (let j = 0; j < c; j++) {

            indices.push(i * col + j)
            indices.push((i + 1) * col + j)
            indices.push(i * col + j + 1)

            indices.push(i * col + j + 1)
            indices.push((i + 1) * col + j)
            indices.push((i + 1) * col + j + 1)
        }
    }

    return {
        positions,
        uvs,
        indices,
    }
}

function quadGrid(time = 5) {

    function middle(v1, v2) {

        return [
            (v1[0] + v2[0]) / 2,
            (v1[1] + v2[1]) / 2,
        ]
    }

    const indices = []
    const positions = []
    const vertexMap = new Map()
    function add2Map(v) {
        
        const key = v.join('-')
        if(!vertexMap.has(key))vertexMap.set(key, positions.length / 2)
        positions.push(v[0])
        positions.push(v[1])
        return v
    }

    const tl = add2Map([0.0, 1.0])
    const bl = add2Map([0.0, 0.0])
    const tr = add2Map([1.0, 1.0])
    const br = add2Map([1.0, 0.0])
    const firstTriangle = {
        fst: tl,
        snd: bl,
        ted: br,
        level: 0,
    }
    const secondTriangle = {
        fst: br,
        snd: tr,
        ted: tl,
        level: 0,
    }
    const stack = []
    stack.push(firstTriangle)
    stack.push(secondTriangle)

    const triangles = []
    while(stack.length) {

        const triangle = stack.pop(stack)

        if (triangle.level >= time) {
            triangles.push(triangle)
            continue
        }

        const oV1 = triangle.fst
        const oV2 = triangle.snd
        const oV3 = triangle.ted
        const nV = add2Map(middle(oV1, oV3))
        stack.push({ fst: oV1, snd: nV, ted: oV2, level: triangle.level + 0.5 })
        stack.push({ fst: oV3, snd: nV, ted: oV2, level: triangle.level + 0.5 })
    }

    triangles.forEach(triangle => {

        const kV1 = triangle.fst.join('-')
        const kV2 = triangle.snd.join('-')
        const kV3 = triangle.ted.join('-')

        indices.push(vertexMap.get(kV1))
        indices.push(vertexMap.get(kV2))
        indices.push(vertexMap.get(kV3))
    })

    return {
        positions,
        indices,
    }
}

function encodeFloatToDouble(value) {
    const result = new Float32Array(2);
    result[0] = value;
    
    const delta = value - result[0];
    result[1] = delta;
    return result;
}

// function tessellatePolygon(coordinates) {

//     let tessy = new GluTesselator();
// }

/**
 * @type {TerrainTile}
 */
let terrain2d = undefined
const MAX_LEVEL = 14
const coordinates = [
    120.0437360613468201,
    31.1739019522094871,
    121.9662324011692220,
    32.0840108580467813,
]
const boundaryCondition = BoundingBox2D.create([
    120.0437360613468201,
    31.1739019522094871,
    121.9662324011692220,
    32.0840108580467813,
])

/**
 * @type {Scratch.Screen}
 */
let screen

let indexNum = 0
let indexBuffer = undefined
let positionBuffer = undefined

let originMatrix = undefined
let mapMatrix = undefined
let highX = undefined
let highY = undefined
let highZ = undefined
let highE = undefined
let lowX = undefined
let lowY = undefined
let lowZ = undefined
let lowE = undefined

let nodeBoxBuffer = undefined
let nodeLevelBuffer = undefined

let gStaticBuffer = undefined
let gDynamicBuffer = undefined

let demTexture = undefined
let borderTexture = undefined
let paletteTexture = undefined
let lodMapTexture = undefined

let lodMapPass = undefined

let meshRenderPass = undefined
let meshRenderPipeline = undefined

let isInitialized = false
let terrainWorker = undefined

/**
 * @type {Scratch.SamplerDescription}
 */
const lSamplerDesc = {
    name: 'Sampler (linear)',
    bindingType: 'filtering',
    filterMinMag: ['linear', 'linear'],
    addressModeUVW: ['clamp-to-edge', 'clamp-to-edge'],
    mipmap: 'linear',
}
const waterColor = [3.0 / 255.0, 38.0 / 255.0, 36.0 / 255.0]

export class DEMLayer {
    
    constructor() {

        this.id = 'DemLayer'
        this.type = 'custom'
        this.renderingMode = '3d'
        this.map = undefined
        this.isInitialized = false
        Scratch.StartDash()
    }

    async onAdd(map, gl) {

        /**
         * @type {mapboxgl.Map}
         */
        this.map = map

        /**
         * @type {HTMLCanvasElement}
         */
        const gpuCanvas = document.getElementById('WebGPUFrame')
        // terrainWorker = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' })

        if (!terrainWorker) {

            screen = Scratch.Screen.create({ canvas: gpuCanvas })
            const sceneTexture = screen.createScreenDependentTexture('Texture (DEM Scene)')
            const maskTexture = screen.createScreenDependentTexture('Texture (DEM Mask)')
            // const demCanvas = screen.createScreenDependentTexture('Texture (DEM Canvas)')
            const depthTexture = screen.createScreenDependentTexture('Texture (Depth)', 'depth32float')
            const fxaaPass = Scratch.FXAAPass.create({
                threshold: 0.0312,
                searchStep: 10,
                inputColorAttachment: sceneTexture,
            })
            screen.addScreenDependentTexture(fxaaPass.getOutputAttachment())

            demTexture = Scratch.imageLoader.load('Texture (Water DEM)', '/images/dem.png')
            borderTexture = Scratch.imageLoader.load('Texture (Water DEM)', '/images/border.png')
            paletteTexture = Scratch.imageLoader.load('Texture (DEM Palette)', '/images/demPalette_1d.png')
            lodMapTexture = Scratch.Texture.create({
                name: 'Texture (LOD Map)',
                format: 'rgba8unorm',
                resource: { size: () => [256, 256] }
            })

            const { positions, indices } = quadGrid(5)
            indexNum = indices.length
            positionBuffer = Scratch.VertexBuffer.create({
                name: 'Vertex Buffer (Terrain Position)',
                randomAccessible: true,
                resource: { arrayRef: Scratch.aRef(new Float32Array(positions)), structure: [{components: 2}] }
            }).use()
            indexBuffer = Scratch.IndexBuffer.create({
                name: 'Index Buffer (Terrain Index)',
                randomAccessible: true,
                resource: { arrayRef: Scratch.aRef(new Uint32Array(indices)) }
            }).use()

            gStaticBuffer = Scratch.UniformBuffer.create({
                name: 'Uniform Buffer (Terrain global static)',
                blocks: [
                    Scratch.bRef({
                        name: 'block',
                        code: `
                            adjust: mat4x4f,
                            terrainBox: vec4f,
                            e: vec2f,
                        `,
                        map: {
                            adjust: () => [
                                1.0, 0.0, 0.0, 0.0,
                                0.0, 1.0, 0.0, 0.0,
                                0.0, 0.0, 1, 0.0,
                                0.0, 0.0, 0.0, 1.0
                            ],
                            terrainBox: () => coordinates,
                            e: () => new Float32Array([
                                -80.06899999999999,
                                4.3745,
                            ]),
                        }
                    }),
                ]
            }).use()
            gStaticBuffer.update()
    
            gDynamicBuffer = Scratch.UniformBuffer.create({
                name: 'Uniform Buffer (Terrain global dynamic)',
                blocks: [
                    Scratch.bRef({
                        name: 'dynamicUniform',
                        dynamic: true,
                        code: `
                            matrix: mat4x4f,
                            oMatrix: mat4x4f,
                            exaggeration: f32,
                            zoom: f32,
                            centerLow: vec2f,
                            centerHigh: vec2f,
                            z: vec2f,
                        `,
                        map: {
                            matrix: () => mapMatrix,
                            oMatrix: () => originMatrix,
                            exaggeration: () => 3.0,
                            zoom: () => this.map.getZoom(),
                            centerLow: () => new Float32Array([ lowX, lowY ]),
                            centerHigh: () => new Float32Array([ highX, highY ]),
                            z: () => [ highZ, lowZ ],
                        }
                    }),
                ]
            }).use()

            // const bridgeColumn = await axios.get('/json/bridgeSurf.geojson').then((response) => {
            const bridgeColumn = await axios.get('/json/bridgeColumn.geojson').then((response) => {
                return response.data
            })

            {
                // let all = []
                // let bc_tess_vertices = []
                // let numFeatures = bridgeColumn.features.length
                // bridgeColumn.features.forEach((feature, index) => {
    
                //     lonMin = Infinity, lonMax = -Infinity
                //     latMin = Infinity, latMax = -Infinity
                //     feature.geometry.coordinates[0].forEach(coords => {
                //         lonMin = coords[0] < lonMin ? coords[0] : lonMin
                //         lonMax = coords[0] > lonMax ? coords[0] : lonMax
                //         latMin = coords[1] < latMin ? coords[1] : latMin
                //         latMax = coords[1] > latMax ? coords[1] : latMax
                //     })
                //     const Min = mapboxgl.MercatorCoordinate.fromLngLat([lonMin, latMin])
                //     const Max = mapboxgl.MercatorCoordinate.fromLngLat([lonMax, latMax])
                //     lonMin = Min.x, latMin = Min.y
                //     lonMax = Max.x, latMax = Max.y
    
                //     tessy.gluTessNormal(0, 0, 1)
                //     tessy.gluTessBeginPolygon(bc_tess_vertices)
                //     tessy.gluTessBeginContour()
    
                //     feature.geometry.coordinates[0].forEach(d => {
            
                //         const coords = [d[0], d[1], 0]
                //         tessy.gluTessVertex(coords, coords)
                        
                //     })
                //     tessy.gluTessEndContour()
                //     tessy.gluTessEndPolygon()
                //     all = bc_tess_vertices.concat(all)
                //     bc_tess_vertices = []
                // })
                // bc_tess_vertices = all
                // console.log(bc_tess_vertices)
            }

            let bc_indices = []
            let bc_vertices = []
            let lonMin = Infinity, lonMax = -Infinity
            let latMin = Infinity, latMax = -Infinity
            bridgeColumn.features.forEach(feature => {

                feature.geometry.coordinates[0][0].forEach(coords => {
                    lonMin = coords[0] < lonMin ? coords[0] : lonMin
                    lonMax = coords[0] > lonMax ? coords[0] : lonMax
                    latMin = coords[1] < latMin ? coords[1] : latMin
                    latMax = coords[1] > latMax ? coords[1] : latMax
                })
            })
            let mCoordMin = mapboxgl.MercatorCoordinate.fromLngLat([lonMin, latMin])
            let mCoordMax = mapboxgl.MercatorCoordinate.fromLngLat([lonMax, latMax])
            let hlMinLon = encodeFloatToDouble(mCoordMin.x)
            let hlMinLat = encodeFloatToDouble(mCoordMin.y)
            let hlMaxLon = encodeFloatToDouble(mCoordMax.x)
            let hlMaxLat = encodeFloatToDouble(mCoordMax.y)

            bridgeColumn.features.forEach(feature => {

                const tempCoords = []
                feature.geometry.coordinates[0][0].forEach(coords => {

                    const mCoords = mapboxgl.MercatorCoordinate.fromLngLat(coords)
                    tempCoords.push((mCoords.x - mCoordMin.x) / (mCoordMax.x - mCoordMin.x))
                    tempCoords.push((mCoords.y - mCoordMin.y) / (mCoordMax.y - mCoordMin.y))
                })
                const triangles = earcut(tempCoords, null, 2)

                for (let i = 0; i < triangles.length; i++) bc_indices.push(bc_vertices.length / 7 + triangles[i])
                for (let i = 0; i < tempCoords.length; i += 2) {
                    
                    const lon = tempCoords[i + 0]
                    const lat = tempCoords[i + 1]
                    const hlLon = encodeFloatToDouble(lon)
                    const hlLat = encodeFloatToDouble(lat)
                    bc_vertices.push(hlLon[0])
                    bc_vertices.push(hlLat[0])
                    bc_vertices.push(hlLon[1])
                    bc_vertices.push(hlLat[1])
                    bc_vertices.push(Math.random())
                    bc_vertices.push(Math.random())
                    bc_vertices.push(Math.random())
                }
            })

            const indexBuffer_bc = Scratch.IndexBuffer.create({
                name: 'Index Buffer (Bridge Column)',
                resource: { arrayRef: Scratch.aRef(new Uint16Array(bc_indices)) }
            })

            const vertexBuffer_bc = Scratch.VertexBuffer.create({
                name: 'Vertex Buffer (Bridge Column)',
                resource: { arrayRef: Scratch.aRef(new Float32Array(bc_vertices)), structure: [ { components: 4 }, { components: 3 } ] }
            })
    
            const binding_bc = Scratch.Binding.create({
                name: 'Binding (Bridge Column)',
                range: () => [ bc_indices.length ],
                sharedUniforms: [
                    { buffer: gStaticBuffer },
                    { buffer: gDynamicBuffer },
                ],
                uniforms: [
                    {
                        name: 'centerUniform',
                        dynamic: true,
                        map: {
                            hlZ: () => new Float32Array([highZ, lowZ]),
                            boundsH: () => [hlMinLon[0], hlMinLat[0], hlMaxLon[0], hlMaxLat[0]],
                            boundsL: () => [hlMinLon[1], hlMinLat[1], hlMaxLon[1], hlMaxLat[1]],
                            eT: () => encodeFloatToDouble(4.3745),
                            eB: () => encodeFloatToDouble(-80.06899999999999),
                        }
                    }
                ],
                index: { buffer: indexBuffer_bc },
                vertices: [ 
                    { buffer: vertexBuffer_bc },
                ],
                textures: [
                    { texture: demTexture },
                ],
            })

            const bcRenderPipeline = Scratch.RenderPipeline.create({
                name: 'Render Pipeline (Bridge Column)',
                shader: Scratch.shaderLoader.load('Shader (Bridge)', '/shaders/bridge.wgsl'),
                depthTest: true,
            })

            // const canvasBinding = Scratch.Binding.create({
            //     name: 'Binding (Last)',
            //     range: () => [4],
            //     samplers: [ lSamplerDesc ],
            //     textures: [
            //         { texture: sceneTexture },
            //         { texture: maskTexture },
            //         { texture: lodMapTexture },
            //     ]
            // })

            const outputBinding = Scratch.Binding.create({
                range: () => [4],
                samplers: [ lSamplerDesc ],
                uniforms: [
                    {
                        name: 'staticUniform',
                        map: {
                            gamma: () => 1.0,
                        }
                    }
                ],
                textures: [ { texture: fxaaPass.getOutputAttachment()} ]
            })

            const canvasRenderPipeline = Scratch.RenderPipeline.create({
                name: 'Render Pipeline (Last)',
                shader: Scratch.shaderLoader.load('Shader (Water DEM)', '/shaders/demCanvas.wgsl'),
                primitive: { topology: 'triangle-strip' },
                colorTargetStates: [ { blend: Scratch.NormalBlending } ]
            })

            const outputPipeline = Scratch.RenderPipeline.create({
                shader: Scratch.shaderLoader.load('Shader (Output)', '/shaders/last.wgsl'),
                primitive: { topology: 'triangle-strip' },
            })

            lodMapPass = Scratch.RenderPass.create({
                name: 'Render Pass (LOD Map)',
                colorAttachments: [ { colorResource: lodMapTexture } ]
            })

            meshRenderPass = Scratch.RenderPass.create({
                name: 'Render Pass (Water DEM)',
                colorAttachments: [ { colorResource: sceneTexture } ],
                depthStencilAttachment: { depthStencilResource: depthTexture }
            })

            // const canvasRenderPass = Scratch.RenderPass.create({
            //     name: 'Render Pass (Last)',
            //     colorAttachments: [
            //         { colorResource: demCanvas }
            //     ]
            // }).add(canvasRenderPipeline, canvasBinding)

            const outputRenderPass = Scratch.RenderPass.create({
                name: 'DEM Layer Output',
                colorAttachments: [ { colorResource: screen.getCurrentCanvasTexture() } ]
            }).add(outputPipeline, outputBinding)

            Scratch.director.addStage({
                name: 'Water DEM Shower',
                items: [
                    lodMapPass,
                    meshRenderPass,
                    // canvasRenderPass,
                    fxaaPass,
                    outputRenderPass,
                ]
            })

            meshRenderPass.add(bcRenderPipeline, binding_bc)
            terrain2d = new TerrainTile(MAX_LEVEL)
        } else {

            const offscreenCanvas = gpuCanvas.transferControlToOffscreen()
            terrainWorker.postMessage(
                {
                    type: 'INIT',
                    canvas: offscreenCanvas
                },
                [
                    offscreenCanvas
                ]
            )

            terrainWorker.addEventListener('message', (e) => {
            
                isInitialized = true
            })
        }

        this.isInitialized = true
    }

    render(gl, matrix) {

        if (!this.isInitialized) return

        // this.map.triggerRepaint()

        if (!terrainWorker) {
    
            if (!terrain2d) return

            const cameraPos = new mapboxgl.MercatorCoordinate(...this.map.transform._computeCameraPosition().slice(0, 2)).toLngLat()
            const cameraBounds = new BoundingBox2D(this.map.getBounds().toArray().flat())
            const zoomLevel = this.map.getZoom()
            const mapCenter = this.map.getCenter()
            const cameraHeight = new mapboxgl.MercatorCoordinate(...this.map.transform._computeCameraPosition().slice(0, 3)).toAltitude()
            const mercatorCenter = mapboxgl.MercatorCoordinate.fromLngLat([mapCenter.lng, mapCenter.lat], cameraHeight)
            const mercatorCenterX = encodeFloatToDouble(mercatorCenter.x)
            const mercatorCenterY = encodeFloatToDouble(mercatorCenter.y)
            const mercatorCenterZ = encodeFloatToDouble(mercatorCenter.z)
            lowX = mercatorCenterX[1]
            lowY = mercatorCenterY[1]
            lowZ = mercatorCenterZ[1]
            highX = mercatorCenterX[0]
            highY = mercatorCenterY[0]
            highZ = mercatorCenterZ[0]
            // console.log(highX, highY, highZ)
            mapMatrix = new Float32Array(getMercatorMatrix(this.map.transform.clone()))
            mapMatrix[12] += mapMatrix[0] * highX + mapMatrix[4] * highY
            mapMatrix[13] += mapMatrix[1] * highX + mapMatrix[5] * highY
            mapMatrix[14] += mapMatrix[2] * highX + mapMatrix[6] * highY
            mapMatrix[15] += mapMatrix[3] * highX + mapMatrix[7] * highY
            // originMatrix = matrix.slice()
            originMatrix = new Float32Array(getMercatorMatrix(this.map.transform.clone()))
            originMatrix[12] += originMatrix[0] * highX + originMatrix[4] * highY + originMatrix[8] * highZ
            originMatrix[13] += originMatrix[1] * highX + originMatrix[5] * highY + originMatrix[9] * highZ
            originMatrix[14] += originMatrix[2] * highX + originMatrix[6] * highY + originMatrix[10] * highZ
            originMatrix[15] += originMatrix[3] * highX + originMatrix[7] * highY + originMatrix[11] * highZ

            gDynamicBuffer.update()

            terrain2d.registerRenderableNode({
                cameraBounds,
                cameraPos: [cameraPos.lng, cameraPos.lat],
                zoomLevel,
            })

            screen.swap()
            Scratch.director.tick()
        }
        else {
            if (!isInitialized) return
            console.log("???")
            const cameraBounds = this.map.getBounds().toArray().flat();
            const mapCenter = this.map.getCenter()
            const zoom = this.map.getZoom()

            terrainWorker.postMessage(
                {
                    type: 'RENDER',
                    options: {
                        cameraBounds: BoundingBox2D.create(cameraBounds),
                        cameraPos: [mapCenter.lng, mapCenter.lat],
                        zoomLevel: zoom
                    },
                    matrix: new Float32Array(getMercatorMatrix(this.map.transform.clone())),
                    zoom: zoom,
                }
            )
        }
        
    }
}

function smoothstep(e0, e1, x) {
    x = clamp((x - e0) / (e1 - e0), 0, 1);
    return x * x * (3 - 2 * x);
}

function getProjectionInterpolationT(projection, zoom, width, height, maxSize = Infinity) {
    const range = projection.range;
    if (!range) return 0;

    const size = Math.min(maxSize, Math.max(width, height));
    // The interpolation ranges are manually defined based on what makes
    // sense in a 1024px wide map. Adjust the ranges to the current size
    // of the map. The smaller the map, the earlier you can start unskewing.
    const rangeAdjustment = Math.log(size / 1024) / Math.LN2;
    const zoomA = range[0] + rangeAdjustment;
    const zoomB = range[1] + rangeAdjustment;
    const t = smoothstep(zoomA, zoomB, zoom);
    return t;
}

function getMercatorMatrix(t) {
    
    if (!t.height) return;

    const offset = t.centerOffset;

    // Z-axis uses pixel coordinates when globe mode is enabled
    const pixelsPerMeter = t.pixelsPerMeter;

    if (t.projection.name === 'globe') {
        t._mercatorScaleRatio = mercatorZfromAltitude(1, t.center.lat) / mercatorZfromAltitude(1, GLOBE_SCALE_MATCH_LATITUDE);
    }

    const projectionT = getProjectionInterpolationT(t.projection, t.zoom, t.width, t.height, 1024);

    // 'this._pixelsPerMercatorPixel' is the ratio between pixelsPerMeter in the current projection relative to Mercator.
    // This is useful for converting e.g. camera position between pixel spaces as some logic
    // such as raycasting expects the scale to be in mercator pixels
    t._pixelsPerMercatorPixel = t.projection.pixelSpaceConversion(t.center.lat, t.worldSize, projectionT);

    t.cameraToCenterDistance = 0.5 / Math.tan(t._fov * 0.5) * t.height * t._pixelsPerMercatorPixel;

    t._updateCameraState();

    t._farZ = t.projection.farthestPixelDistance(t);

    // The larger the value of nearZ is
    // - the more depth precision is available for features (good)
    // - clipping starts appearing sooner when the camera is close to 3d features (bad)
    //
    // Smaller values worked well for mapbox-gl-js but deckgl was encountering precision issues
    // when rendering it's layers using custom layers. This value was experimentally chosen and
    // seems to solve z-fighting issues in deckgl while not clipping buildings too close to the camera.
    t._nearZ = t.height / 50;

    let _farZ = Math.max(Math.pow(2, t.tileZoom), 5000000.0)
    // let _nearZ = Math.max(Math.pow(2, t.tileZoom - 8), 0.0)

    const zUnit = t.projection.zAxisUnit === "meters" ? pixelsPerMeter : 1.0;
    const worldToCamera = t._camera.getWorldToCamera(t.worldSize, zUnit);

    let cameraToClip;

    const cameraToClipPerspective = t._camera.getCameraToClipPerspective(t._fov, t.width / t.height, t._nearZ, _farZ);
    // Apply offset/padding
    cameraToClipPerspective[8] = -offset.x * 2 / t.width;
    cameraToClipPerspective[9] = offset.y * 2 / t.height;

    if (t.isOrthographic) {
        const cameraToCenterDistance =  0.5 * t.height / Math.tan(t._fov / 2.0) * 1.0;

        // Calculate bounds for orthographic view
        let top = cameraToCenterDistance * Math.tan(t._fov * 0.5);
        let right = top * t.aspect;
        let left = -right;
        let bottom = -top;
        // Apply offset/padding
        right -= offset.x;
        left -= offset.x;
        top += offset.y;
        bottom += offset.y;

        cameraToClip = t._camera.getCameraToClipOrthographic(left, right, bottom, top, t._nearZ, t._farZ);

        const mixValue =
        t.pitch >= OrthographicPitchTranstionValue ? 1.0 : t.pitch / OrthographicPitchTranstionValue;
        // lerpMatrix(cameraToClip, cameraToClip, cameraToClipPerspective, easeIn(mixValue));
    } else {
        cameraToClip = cameraToClipPerspective;
    }

    const worldToClipPerspective = mat4.mul([], cameraToClipPerspective, worldToCamera);
    let m = mat4.mul([], cameraToClip, worldToCamera);

    if (t.projection.isReprojectedInTileSpace) {
        // Projections undistort as you zoom in (shear, scale, rotate).
        // Apply the undistortion around the center of the map.
        const mc = t.locationCoordinate(t.center);
        const adjustments = mat4.identity([]);
        mat4.translate(adjustments, adjustments, [mc.x * t.worldSize, mc.y * t.worldSize, 0]);
        mat4.multiply(adjustments, adjustments, getProjectionAdjustments(t));
        mat4.translate(adjustments, adjustments, [-mc.x * t.worldSize, -mc.y * t.worldSize, 0]);
        mat4.multiply(m, m, adjustments);
        mat4.multiply(worldToClipPerspective, worldToClipPerspective, adjustments);
        t.inverseAdjustmentMatrix = getProjectionAdjustmentInverted(t);
    } else {
        t.inverseAdjustmentMatrix = [1, 0, 0, 1];
    }

    // The mercatorMatrix can be used to transform points from mercator coordinates
    // ([0, 0] nw, [1, 1] se) to GL coordinates. / zUnit compensates for scaling done in worldToCamera.
    t.mercatorMatrix = mat4.scale([], m, [t.worldSize, t.worldSize, t.worldSize / zUnit, 1.0]);

    t.projMatrix = m;

    // For tile cover calculation, use inverted of base (non elevated) matrix
    // as tile elevations are in tile coordinates and relative to center elevation.
    t.invProjMatrix = mat4.invert(new Float64Array(16), t.projMatrix);

    return t.mercatorMatrix

    // const clipToCamera = mat4.invert([], cameraToClip);
    // t.frustumCorners = FrustumCorners.fromInvProjectionMatrix(clipToCamera, t.horizonLineFromTop(), t.height);

    // // Create a camera frustum in mercator units
    // t.cameraFrustum = Frustum.fromInvProjectionMatrix(t.invProjMatrix, t.worldSize, 0.0, !isGlobe);

    // const view = new Float32Array(16);
    // mat4.identity(view);
    // mat4.scale(view, view, [1, -1, 1]);
    // mat4.rotateX(view, view, t._pitch);
    // mat4.rotateZ(view, view, t.angle);

    // const projection = mat4.perspective(new Float32Array(16), t._fov, t.width / t.height, t._nearZ, t._farZ);

    // t.starsProjMatrix = mat4.clone(projection);

    // // The distance in pixels the skybox needs to be shifted down by to meet the shifted horizon.
    // const skyboxHorizonShift = (Math.PI / 2 - t._pitch) * (t.height / t._fov) * t._horizonShift;
    // // Apply center of perspective offset to skybox projection
    // projection[8] = -offset.x * 2 / t.width;
    // projection[9] = (offset.y + skyboxHorizonShift) * 2 / t.height;
    // t.skyboxMatrix = mat4.multiply(view, projection, view);

    // // Make a second projection matrix that is aligned to a pixel grid for rendering raster tiles.
    // // We're rounding the (floating point) x/y values to achieve to avoid rendering raster images to fractional
    // // coordinates. Additionally, we adjust by half a pixel in either direction in case that viewport dimension
    // // is an odd integer to preserve rendering to the pixel grid. We're rotating t shift based on the angle
    // // of the transformation so that 0°, 90°, 180°, and 270° rasters are crisp, and adjust the shift so that
    // // it is always <= 0.5 pixels.
    // const point = t.point;
    // const x = point.x, y = point.y;
    // const xShift = (t.width % 2) / 2, yShift = (t.height % 2) / 2,
    //     angleCos = Math.cos(t.angle), angleSin = Math.sin(t.angle),
    //     dx = x - Math.round(x) + angleCos * xShift + angleSin * yShift,
    //     dy = y - Math.round(y) + angleCos * yShift + angleSin * xShift;
    // const alignedM = new Float64Array(m);
    // mat4.translate(alignedM, alignedM, [ dx > 0.5 ? dx - 1 : dx, dy > 0.5 ? dy - 1 : dy, 0 ]);
    // t.alignedProjMatrix = alignedM;

    // m = mat4.create();
    // mat4.scale(m, m, [t.width / 2, -t.height / 2, 1]);
    // mat4.translate(m, m, [1, -1, 0]);
    // t.labelPlaneMatrix = m;

    // m = mat4.create();
    // mat4.scale(m, m, [1, -1, 1]);
    // mat4.translate(m, m, [-1, -1, 0]);
    // mat4.scale(m, m, [2 / t.width, 2 / t.height, 1]);
    // t.glCoordMatrix = m;

    // // matrix for conversion from location to screen coordinates
    // t.pixelMatrix = mat4.multiply(new Float64Array(16), t.labelPlaneMatrix, worldToClipPerspective);

    // t._calcFogMatrices();
    // t._distanceTileDataCache = {};

    // // inverse matrix for conversion from screen coordinates to location
    // m = mat4.invert(new Float64Array(16), t.pixelMatrix);
    // if (!m) throw new Error("failed to invert matrix");
    // t.pixelMatrixInverse = m;

    // if (t.projection.name === 'globe' || t.mercatorFromTransition) {
    //     t.globeMatrix = calculateGlobeMatrix(t);

    //     const globeCenter = [t.globeMatrix[12], t.globeMatrix[13], t.globeMatrix[14]];

    //     t.globeCenterInViewSpace = vec3.transformMat4(globeCenter, globeCenter, worldToCamera);
    //     t.globeRadius = t.worldSize / 2.0 / Math.PI - 1.0;
    // } else {
    //     t.globeMatrix = m;
    // }

    // t._projMatrixCache = {};
    // t._alignedProjMatrixCache = {};
    // t._pixelsToTileUnitsCache = {};
}

function circumferenceAtLatitude(latitude) {

    const earthRadius = 6371008.8
    const earthCircumference = 2 * Math.PI * earthRadius
    return earthCircumference * Math.cos(latitude * Math.PI / 180)
}

function mercatorZfromAltitude(altitude, lat) {
    return altitude / circumferenceAtLatitude(lat)
}

function getMercatorMatrix2(t) {
    
    if (!t.height) return;

    const offset = t.centerOffset;

    // Z-axis uses pixel coordinates when globe mode is enabled
    const pixelsPerMeter = t.pixelsPerMeter;

    if (t.projection.name === 'globe') {
        t._mercatorScaleRatio = mercatorZfromAltitude(1, t.center.lat) / mercatorZfromAltitude(1, GLOBE_SCALE_MATCH_LATITUDE);
    }

    const projectionT = getProjectionInterpolationT(t.projection, t.zoom, t.width, t.height, 1024);

    // 'this._pixelsPerMercatorPixel' is the ratio between pixelsPerMeter in the current projection relative to Mercator.
    // This is useful for converting e.g. camera position between pixel spaces as some logic
    // such as raycasting expects the scale to be in mercator pixels
    t._pixelsPerMercatorPixel = t.projection.pixelSpaceConversion(t.center.lat, t.worldSize, projectionT);

    t.cameraToCenterDistance = 0.5 / Math.tan(t._fov * 0.5) * t.height * t._pixelsPerMercatorPixel;

    t._updateCameraState();

    t._farZ = t.projection.farthestPixelDistance(t);

    // The larger the value of nearZ is
    // - the more depth precision is available for features (good)
    // - clipping starts appearing sooner when the camera is close to 3d features (bad)
    //
    // Smaller values worked well for mapbox-gl-js but deckgl was encountering precision issues
    // when rendering it's layers using custom layers. This value was experimentally chosen and
    // seems to solve z-fighting issues in deckgl while not clipping buildings too close to the camera.
    t._nearZ = t.height / 50;

    let _farZ = Math.max(t._farZ, - 1 / mercatorZfromAltitude(-80.06899999999999, t.center.lat))
    let _nearZ = Math.max(t._nearZ, mercatorZfromAltitude(4.3745, t.center.lat))

    const zUnit = t.projection.zAxisUnit === "meters" ? pixelsPerMeter : 1.0;
    const worldToCamera = t._camera.getWorldToCamera(t.worldSize, zUnit);

    let cameraToClip;

    const cameraToClipPerspective = t._camera.getCameraToClipPerspective(t._fov, t.width / t.height, _nearZ, _farZ);
    // Apply offset/padding
    cameraToClipPerspective[8] = -offset.x * 2 / t.width;
    cameraToClipPerspective[9] = offset.y * 2 / t.height;

    if (t.isOrthographic) {
        const cameraToCenterDistance =  0.5 * t.height / Math.tan(t._fov / 2.0) * 1.0;

        // Calculate bounds for orthographic view
        let top = cameraToCenterDistance * Math.tan(t._fov * 0.5);
        let right = top * t.aspect;
        let left = -right;
        let bottom = -top;
        // Apply offset/padding
        right -= offset.x;
        left -= offset.x;
        top += offset.y;
        bottom += offset.y;

        cameraToClip = t._camera.getCameraToClipOrthographic(left, right, bottom, top, t._nearZ, t._farZ);

        const mixValue =
        t.pitch >= OrthographicPitchTranstionValue ? 1.0 : t.pitch / OrthographicPitchTranstionValue;
        // lerpMatrix(cameraToClip, cameraToClip, cameraToClipPerspective, easeIn(mixValue));
    } else {
        cameraToClip = cameraToClipPerspective;
    }

    const worldToClipPerspective = mat4.mul([], cameraToClipPerspective, worldToCamera);
    let m = mat4.mul([], cameraToClip, worldToCamera);

    if (t.projection.isReprojectedInTileSpace) {
        // Projections undistort as you zoom in (shear, scale, rotate).
        // Apply the undistortion around the center of the map.
        const mc = t.locationCoordinate(t.center);
        const adjustments = mat4.identity([]);
        mat4.translate(adjustments, adjustments, [mc.x * t.worldSize, mc.y * t.worldSize, 0]);
        mat4.multiply(adjustments, adjustments, getProjectionAdjustments(t));
        mat4.translate(adjustments, adjustments, [-mc.x * t.worldSize, -mc.y * t.worldSize, 0]);
        mat4.multiply(m, m, adjustments);
        mat4.multiply(worldToClipPerspective, worldToClipPerspective, adjustments);
        t.inverseAdjustmentMatrix = getProjectionAdjustmentInverted(t);
    } else {
        t.inverseAdjustmentMatrix = [1, 0, 0, 1];
    }

    // The mercatorMatrix can be used to transform points from mercator coordinates
    // ([0, 0] nw, [1, 1] se) to GL coordinates. / zUnit compensates for scaling done in worldToCamera.
    t.mercatorMatrix = mat4.scale([], m, [t.worldSize, t.worldSize, t.worldSize / zUnit, 1.0]);

    t.projMatrix = m;

    // For tile cover calculation, use inverted of base (non elevated) matrix
    // as tile elevations are in tile coordinates and relative to center elevation.
    t.invProjMatrix = mat4.invert(new Float64Array(16), t.projMatrix);

    return t.mercatorMatrix
}