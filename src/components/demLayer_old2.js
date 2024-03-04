import mapboxgl from 'mapbox-gl'
import * as Scratch from './scratch/scratch.js'
import { mat4, vec4 } from 'gl-matrix'
import * as turf from '@turf/turf'
import { TerrainNode2D, computeBindings, renderBindings } from './terrain.js'

const terrainWorker = new Worker(new URL( './terrain.worker.js', import.meta.url ))

function encodeGeohash(longitude, latitude, precision = 16) {
    
    const base32Chars = "0123456789bcdefghjkmnpqrstuvwxyz"
    let geohash = ""
    let minLat = -90, maxLat = 90
    let minLon = -180, maxLon = 180
    let isEven = true
    let bit = 0, ch = 0

    while(geohash.length < precision) {
        const mid = isEven ? (minLon + maxLon) / 2 : (minLat + maxLat) / 2
        if (isEven) {
            if (longitude > mid) {
                ch |= 1 << (4 - bit)
                minLon = mid
            } else {
                maxLon = mid
            }
        } else {
            if (latitude > mid) {
                ch |= 1 << (4 - bit)
                minLat = mid
            } else {
                maxLat = mid
            }
        }

        isEven = !isEven
        if (bit < 4) {
            bit++
        } else {
            geohash += base32Chars[ch]
            bit = 0
            ch = 0
        }
    }
    return geohash
}

function decodeGeohash(geohash) {

    const base32Chars = "0123456789bcdefghjkmnpqrstuvwxyz"
    let bits = ""
    for (let i = 0; i < geohash.length; i++) {
        const char = geohash[i]
        const index = base32Chars.indexOf(char)
        bits += index.toString(2).padStart(5, "0")
    }
    let isEven = true
    let minLat = -90, maxLat = 90
    let minLon = -180, maxLon = 180

    for (let i = 0; i < bits.length; i++) {
        const bit = parseInt(bits[i])
        if (isEven) {
            if (bit === 1) {
                minLon = (minLon + maxLon) / 2
            } else {
                maxLon = (minLon + maxLon) / 2
            }
        } else {
            if (bit === 1) {
                minLat = (minLat + maxLat) / 2
            } else {
                maxLat = (minLat + maxLat) / 2
            }
        }

        isEven = !isEven
    }

    const latitude = (minLat + maxLat) / 2
    const longitude = (minLon + maxLon) / 2

    return {
        longitude: longitude,
        latitude: latitude
    }
}

const waterColor = [3.0 / 255.0, 38.0 / 255.0, 36.0 / 255.0]
const coordinates = [
    120.0437360613468201,
    121.9662324011692220,
    32.0840108580467813,
    31.1739019522094871,
]
const exaggeration = 3.0

function mix(a, b, f) {

    const factor = Math.max(0.0, Math.min(1.0, f))

    return (1.0 - factor) * a + factor * b
}

/**
 * @type {Scratch.Screen}
 */
let screen

// Matrix
let vpMatrix = new Float32Array(16)
let zoom = 0

function grid(row=200, col=200) {
    const positions = []
    const uvs = []
    let rowStep = 1.0 / row
    let colStep = 1.0 / col
    let x = 0.0, y = 0.0
    for (let i = 0; i < row; i++) {
        x = 0.0
        for (let j = 0; j < col; j++) {
            positions.push(x)
            positions.push(y)
            uvs.push(1.0 / col * j)
            uvs.push(1.0 - i / row)
            x += colStep
        }
        y += rowStep
    }

    const indices = []
    for (let i = 1; i < row; i++) {
        for (let j = 1; j < col; j++) {
            indices.push((i - 1) * col + j - 1)
            indices.push((i - 1) * col + j)
            indices.push(i * col + j - 1)

            indices.push(i * col + j - 1)
            indices.push((i - 1) * col + j)
            indices.push(i * col + j)
        }
    }

    return {
        positions,
        uvs,
        indices,
    }
}

class BoundingBox2D {
    
    constructor(boundary) {

        this.boundary = boundary
    }

    static create(boundary) {

        if (boundary) return new BoundingBox2D(boundary)

        return new BoundingBox2D([
            Infinity,
            Infinity,
            -Infinity,
            -Infinity
        ])
    }

    update(x, y) {
        
        this.boundary[0] = x < this.boundary[0] ? x : this.boundary[0]
        this.boundary[1] = y < this.boundary[1] ? y : this.boundary[1]
        this.boundary[2] = x > this.boundary[2] ? x : this.boundary[2]
        this.boundary[3] = y > this.boundary[3] ? y : this.boundary[3]
    }
}

let count = 0
const maxLodLevel = 1
class TerrainNode {

    /**
     * @param {Array<number>} bbox [minX, minY, maxX, maxY]
     * @param {number} tileSize
     * @param { Scratch.Texture} dem
     * @param { Scratch.Texture} border
     * @param {number} lodLevel 
     * @param {{units: turf.Units}} [options = {units: 'meters'}] 
     */
    constructor(bbox, tileSize, dem, border, lodLevel, options = {units: 'meters'}) {

        count++
        this.bbox = bbox
        this.demTexture = dem
        this.borderTexture = border
        this.lodLevel = lodLevel
        this.tileSize = tileSize

        this.options = options
        
        this.tl = turf.point([bbox[0], bbox[3]])
        // this.tr = turf.destination(this.tl, this.tileSize, 90, this.options)
        // this.bl = turf.destination(this.tl, this.tileSize, 180, this.options)
        // this.br = turf.destination(this.tr, this.tileSize, 180, this.options)
        this.tr = turf.point([bbox[2], bbox[3]])
        this.bl = turf.point([bbox[0], bbox[1]])
        this.br = turf.point([bbox[2], bbox[1]])

        // this.width = turf.distance(this.tl, this.tr, this.options)
        // this.height = turf.distance(this.tl, this.bl, this.options)

        /**
         * @type {Scratch.Binding}
         */
        this.renderBinding = undefined
        /**
         * @type {Scratch.Binding}
         */
        this.computeBinding = undefined

        /**
         * @type {Array<TerrainNode>}
         */
        this.children = []
        this.makeQuadBinding()
        this.makeQuadNodes()

    }

    makeQuadNodes() {

        if (this.lodLevel >= maxLodLevel) return 

        // const subWidth = this.width / 2
        // const subHeight = this.height / 2
        const subTileSize = this.tileSize / 2

        for(let i = 0; i < 2; i++) {
            for (let j = 0; j < 2; j++) {

                let subTl = turf.destination(this.tl, subTileSize * i, 90, this.options)
                let subTr = turf.destination(this.tr, subTileSize * i, 90, this.options)
                let subBl = turf.destination(this.bl, subTileSize * j, 180, this.options)
                let subBr = turf.destination(this.br, subTileSize * j, 180, this.options)

                let subBBox = [
                    subTl.geometry.coordinates[0],
                    subBl.geometry.coordinates[1],
                    subBr.geometry.coordinates[0],
                    subTr.geometry.coordinates[1],
                ]

                this.children.push(new TerrainNode(subBBox, this.tileSize / 2, this.demTexture, this.borderTexture, this.lodLevel + 1, this.options))
            }
        }
    }

    makeQuadBinding() {
        const tGrid = turf.triangleGrid([...this.bbox], this.tileSize, this.options)
        const tVertices = []
        const tUVs = []
        const tIndices = []
        const vertexMap = new Map()
        
        tGrid.features.forEach((feature, index) => {
            const coords = feature.geometry.coordinates[0]
            const triangles = [
                coords[0], coords[1], coords[2], 
                coords[1], coords[2], coords[3]
            ]

            triangles.forEach(coord => {
                
                const key = coord.join(',')
                if (vertexMap.has(key)) { 

                    tIndices.push(vertexMap.get(key))
                } else {
                    
                    const mercator = mapboxgl.MercatorCoordinate.fromLngLat([coord[0], coord[1]])
                    tVertices.push(mercator.x)
                    tVertices.push(mercator.y)
                    const u = (coord[0] - coordinates[0]) / (coordinates[1] - coordinates[0])
                    const v = (coord[1] - coordinates[3]) / (coordinates[2] - coordinates[3])
                    tUVs.push(u)
                    tUVs.push(v)
                    const newIndex = tVertices.length / 2 - 1
                    vertexMap.set(key, newIndex)
                    tIndices.push(newIndex)
                }
                
            })
        })

        const positionBuffer = Scratch.VertexBuffer.create({
            name: 'Vertex Buffer (Terrain Position)',
            randomAccessible: true,
            resource: { arrayRef: Scratch.aRef(new Float32Array(tVertices)), structure: [{components: 2}] }
        })
        const uvBuffer = Scratch.VertexBuffer.create({
            name: 'Vertex Buffer (Terrain UV)',
            randomAccessible: true,
            resource: { arrayRef: Scratch.aRef(new Float32Array(tUVs)), structure: [{components: 2}] }
        })
        const indexBuffer = Scratch.IndexBuffer.create({
            name: 'Index Buffer (Terrain Index)',
            randomAccessible: true,
            resource: { arrayRef: Scratch.aRef(new Uint32Array(tIndices)) }
        })
        const elevationBuffer = Scratch.VertexBuffer.create({
            name: 'Vertex Buffer (Terrain Elevation)',
            randomAccessible: true,
            resource: { arrayRef: Scratch.aRef(new Float32Array(tVertices.length / 2)), structure: [ { components: 1 } ] }
        })

        /**
         * @type {Scratch.SamplerDescription}
         */
        const lSamplerDesc = {
            name: 'Sampler (linear)',
            bindingType: 'filtering',
            filterMinMag: ['linear', 'linear'],
            addressModeUVW: ['repeat', 'repeat'],
            mipmap: 'linear',
        }

        const blockSize = 16
        const groupWidth = Math.ceil(Math.sqrt(tVertices.length / 2))
        const groupHeight = Math.ceil((tVertices.length / 2) / groupWidth)
        const groupSizeX = Math.ceil(groupWidth / blockSize)
        const groupSizeY = Math.ceil(groupHeight / blockSize)
        this.computeBinding = Scratch.Binding.create({
            name: 'Binding (Elevation Computation)',
            range: () => [ groupSizeX, groupSizeY ],
            uniforms: [
                {
                    name: 'staticUniform',
                    map: {
                        vertexNum: () => tVertices.length / 2,
                        groupSize: () => [ groupSizeX, groupSizeY ],
                        h: () => [
                            0.0,
                            81.507499999999993,
                        ],
                        p: () => [
                            -1.4742, 
                            4.4744999999999999
                        ]  
                    }
                },
                {
                    name: 'dynamicUniform',
                    dynamic: true,
                    map: {
                        exaggeration: () => exaggeration,
                    }
                }
            ],
            storages: [
                { buffer: uvBuffer },
                { buffer: elevationBuffer, writable: true },
            ],
            textures: [
                { texture: this.demTexture },
            ]
        })

        this.renderBinding = Scratch.Binding.create({
            name: 'Binding (Terrain Mesh)',
            range: () => [4, tIndices.length / 3],
            uniforms: [
                {
                    name: 'staticUniform',
                    map: {
                        adjust: () => [
                            1.0, 0.0, 0.0, 0.0,
                            0.0, 1.0, 0.0, 0.0,
                            0.0, 0.0, 0.5, 0.0,
                            0.0, 0.0, 0.5, 1.0
                        ],
                        h: () => [
                            0.0,
                            81.507499999999993,
                        ],
                        p: () => [
                            -1.4742, 
                            4.4744999999999999
                        ]  
                    }
                },
                {
                    name: 'dynamicUniform',
                    dynamic: true,
                    map: {
                        matrix: () => vpMatrix,
                        exaggeration: () => exaggeration,
                        zoom: () => zoom,
                    }
                }
            ],
            samplers: [ lSamplerDesc ],
            textures: [
                { texture: this.demTexture },
                { texture: this.borderTexture },
            ],
            storages: [
                { buffer: indexBuffer },
                { buffer: positionBuffer },
                { buffer: uvBuffer },
                { buffer: elevationBuffer },
            ],
        })
    }
}

class Terrain {

    /**
     * @param {Array<number>} bbox [minX, minY, maxX, maxY]
     * @param {number} rootTileSize
     * @param { Scratch.Texture} dem
     * @param { Scratch.Texture} border
     * @param {{units: turf.Units}} [options = {units: 'meters'}] 
     */
    constructor(bbox, rootTileSize, dem, border, options = {units: 'meters'}) {

        this.bbox = bbox
        this.rootTileSize = rootTileSize
        this.lodLevel = -1
        this.options = options
        this.demTexture = dem
        this.borderTexture = border

        /**
         * @type {Array<TerrainNode>}
         */
        this.children = []

        const triangles = turf.triangleGrid(this.bbox, this.rootTileSize, this.options)
        for (let i = 0; i < triangles.features.length / 2; i += 2) {

            const tri1 = triangles.features[i + 0]
            const tri2 = triangles.features[i + 1]
            const boundary = BoundingBox2D.create()
            tri1.geometry.coordinates[0].filter((_, index) => index < 3)
            .concat(tri2.geometry.coordinates[0].filter((_, index) => index < 3))
            .forEach(coord => boundary.update(coord[0], coord[1]))

            this.children.push(new TerrainNode(boundary.boundary, rootTileSize, this.demTexture, this.borderTexture, this.lodLevel + 1, this.options))
            
        }
        
        // this.tl = turf.point([bbox[0], bbox[3]])
        // this.tr = turf.point([bbox[2], bbox[3]])
        // this.bl = turf.point([bbox[0], bbox[1]])
        // this.br = turf.point([bbox[2], bbox[1]])

        // this.width = turf.distance(this.tl, this.tr, this.options)
        // this.height = turf.distance(this.tl, this.bl, this.options)
        // // this.tr = turf.destination(this.tl, this.width, 90, this.options)
        // // this.bl = turf.destination(this.tl, this.height, 180, this.options)
        // // this.bbox[2] = this.tr.geometry.coordinates[0]
        // // this.bbox[3] = this.tr.geometry.coordinates[1]
        // // console.log(this.bbox)

        // this.horizontalTileNum = Math.ceil(this.width / this.rootTileSize)
        // this.verticalTileNum = Math.ceil(this.height / this.rootTileSize)
        // const wSize = this.width / this.rootTileSize
        // const hSize = this.height / this.rootTileSize
        // this.rootTileSize = Math.max(wSize, hSize)
        // this.tr = turf.destination(this.tl, this.width, 90, this.options)
        // this.bl = turf.destination(this.tl, this.height, 180, this.options)
        // this.bbox[2] = this.tr.geometry.coordinates[0]
        // this.bbox[3] = this.tr.geometry.coordinates[1]

        // /**
        //  * @type {Array<TerrainNode>}
        //  */
        // this.children = []
        // for (let i = 0; i < this.horizontalTileNum; i++) {
        //     for (let j = 0; j < this.verticalTileNum; j++) {

        //         // let subTl = turf.destination(this.tl, rootTileSize * i, 90, this.options)
        //         // subTl = turf.destination(subTl, rootTileSize * j, 180, this.options)
        //         // let subTr = turf.destination(subTl, rootTileSize * (i + 1), 90, this.options)
        //         // subTr = turf.destination(subTr, rootTileSize * j, 180, this.options)
        //         // let subBl = turf.destination(subTl, rootTileSize * i, 90, this.options)
        //         // subBl = turf.destination(subBl, rootTileSize * (j + 1), 180, this.options)
        //         // let subBr = turf.destination(this.tl, rootTileSize * (i + 1), 90, this.options)
        //         // subBr = turf.destination(subBr, rootTileSize * (j + 1), 180, this.options)

        //         let subBBox = [
        //             this.bbox[0] + i * (this.bbox[2] - this.bbox[0]) / this.horizontalTileNum,          // minX
        //             this.bbox[1] + j * (this.bbox[3] - this.bbox[1]) / this.verticalTileNum,            // minY
        //             this.bbox[0] + (i + 1) * (this.bbox[2] - this.bbox[0]) / this.horizontalTileNum,    // maxX
        //             this.bbox[1] + (j + 1) * (this.bbox[3] - this.bbox[1]) / this.verticalTileNum,      // maxY
        //         ]

        //         // let subBBox = [
        //         //     subTl.geometry.coordinates[0],
        //         //     subBl.geometry.coordinates[1],
        //         //     subBr.geometry.coordinates[0],
        //         //     subTr.geometry.coordinates[1],
        //         // ]

        //         this.children.push(new TerrainNode(subBBox, rootTileSize, this.demTexture, this.borderTexture, this.lodLevel + 1, this.options))
        //     }
        // }
    }
}

let terrain2d = undefined

export class DEMLayer {
    
    constructor() {

        this.id = 'DemLayer'
        this.type = 'custom'
        this.renderingMode = '3d'
        this.map = undefined
    }

    onAdd(map, gl) {

        /**
         * @type {mapboxgl.Map}
         */
        this.map = map

        // terrainWorker.postMessage(1)
        

        const gpuCanvas = document.getElementById('WebGPUFrame')
        screen = Scratch.Screen.create({ canvas: gpuCanvas })
        const sceneTexture = screen.createScreenDependentTexture('Texture (DEM Scene)')
        const maskTexture = screen.createScreenDependentTexture('Texture (DEM Mask)')
        const depthTexture = screen.createScreenDependentTexture('Texture (Depth)', 'depth32float')
        const demTexture = Scratch.imageLoader.load('Texture (Water DEM)', '/images/dem.png')
        const borderTexture = Scratch.imageLoader.load('Texture (Water DEM)', '/images/border.png')
        const rockTexture = Scratch.imageLoader.load('Texture (Rocks)', '/images/river/diff_4k.png', true)
        const coastTexture = Scratch.imageLoader.load('Texture (Rocks)', '/images/coast/diff_4k.png', true)

        const cameraBounds = this.map.getBounds().toArray().flat();
    
        if (!terrain2d) terrain2d = new TerrainNode2D(
            {
                cameraBounds: BoundingBox2D.create(cameraBounds),
                zoomLevel: this.map.getZoom()
            },
            0, 
            0, 
        )
        

        const pTL = turf.point([coordinates[0], coordinates[2]])
        const pTR = turf.point([coordinates[1], coordinates[2]])
        const pBL = turf.point([coordinates[0], coordinates[3]])
        const pBR = turf.point([coordinates[1], coordinates[3]])
        const bbox = [
            pTL.geometry.coordinates[0],
            pBL.geometry.coordinates[1],
            pBR.geometry.coordinates[0],
            pTR.geometry.coordinates[1],
        ]
        // console.log('tl:', encodeGeohash(pTL.geometry.coordinates[0], pTL.geometry.coordinates[1]), decodeGeohash('0'), decodeGeohash('1'))
        // console.log('tr:', encodeGeohash(pTR.geometry.coordinates[0], pTR.geometry.coordinates[1]))
        // console.log('bl:', encodeGeohash(pBL.geometry.coordinates[0], pBL.geometry.coordinates[1]))
        // console.log('br:', encodeGeohash(pBR.geometry.coordinates[0], pBR.geometry.coordinates[1]))
        // const terrain = new Terrain(bbox, 0.011, demTexture, borderTexture, { units: 'degrees' })
        // console.log(terrain)
        // console.log(count)
        const tGrid = turf.triangleGrid([coordinates[0], coordinates[3], coordinates[1], coordinates[2]], 150, { units: 'meters' })
        const tVertices = []
        const tUVs = []
        const tIndices = []
        const vertexMap = new Map()
        // console.log(tGrid)
        
        tGrid.features.forEach((feature, index) => {
            const coords = feature.geometry.coordinates[0]
            const triangles = [
                coords[0], coords[1], coords[2], 
                coords[1], coords[2], coords[3]
            ]

            triangles.forEach(coord => {
                
                const key = coord.join(',')
                if (vertexMap.has(key)) { 

                    tIndices.push(vertexMap.get(key))
                } else {
                    
                    const mercator = mapboxgl.MercatorCoordinate.fromLngLat([coord[0], coord[1]])
                    tVertices.push(mercator.x)
                    tVertices.push(mercator.y)
                    const u = (coord[0] - coordinates[0]) / (coordinates[1] - coordinates[0])
                    const v = (coord[1] - coordinates[3]) / (coordinates[2] - coordinates[3])
                    tUVs.push(u)
                    tUVs.push(v)
                    const newIndex = tVertices.length / 2 - 1
                    vertexMap.set(key, newIndex)
                    tIndices.push(newIndex)
                }
                
            })
        })

        const positionBuffer = Scratch.VertexBuffer.create({
            name: 'Vertex Buffer (Terrain Position)',
            randomAccessible: true,
            resource: { arrayRef: Scratch.aRef(new Float32Array(tVertices)), structure: [{components: 2}] }
        })
        const uvBuffer = Scratch.VertexBuffer.create({
            name: 'Vertex Buffer (Terrain UV)',
            randomAccessible: true,
            resource: { arrayRef: Scratch.aRef(new Float32Array(tUVs)), structure: [{components: 2}] }
        })
        const indexBuffer = Scratch.IndexBuffer.create({
            name: 'Index Buffer (Terrain Index)',
            randomAccessible: true,
            resource: { arrayRef: Scratch.aRef(new Uint32Array(tIndices)) }
        })
        const elevationBuffer = Scratch.VertexBuffer.create({
            name: 'Vertex Buffer (Terrain Elevation)',
            randomAccessible: true,
            resource: { arrayRef: Scratch.aRef(new Float32Array(tVertices.length / 2)), structure: [ { components: 1 } ] }
        })

        /**
         * @type {Scratch.SamplerDescription}
         */
        const lSamplerDesc = {
            name: 'Sampler (linear)',
            bindingType: 'filtering',
            filterMinMag: ['linear', 'linear'],
            addressModeUVW: ['repeat', 'repeat'],
            mipmap: 'linear',
        }

        const blockSize = 16
        const groupWidth = Math.ceil(Math.sqrt(tVertices.length / 2))
        const groupHeight = Math.ceil((tVertices.length / 2) / groupWidth)
        const groupSizeX = Math.ceil(groupWidth / blockSize)
        const groupSizeY = Math.ceil(groupHeight / blockSize)
        const elevationBinding = Scratch.Binding.create({
            name: 'Binding (Elevation Computation)',
            // range: () => [ Math.ceil(558 / 16), Math.ceil(1024 / 16) ],
            range: () => [ groupSizeX, groupSizeY ],
            uniforms: [
                {
                    name: 'staticUniform',
                    map: {
                        vertexNum: () => tVertices.length / 2,
                        groupSize: () => [ groupSizeX, groupSizeY ],
                        h: () => [
                            0.0,
                            81.507499999999993,
                        ],
                        p: () => [
                            -1.4742, 
                            4.4744999999999999
                        ]  
                    }
                },
                {
                    name: 'dynamicUniform',
                    dynamic: true,
                    map: {
                        exaggeration: () => exaggeration,
                    }
                }
            ],
            storages: [
                { buffer: uvBuffer },
                { buffer: elevationBuffer, writable: true },
            ],
            textures: [
                { texture: demTexture },
            ]
        })

        const meshBinding = Scratch.Binding.create({
            name: 'Binding (Terrain Mesh)',
            range: () => [4, tIndices.length / 3],
            uniforms: [
                {
                    name: 'staticUniform',
                    map: {
                        adjust: () => [
                            1.0, 0.0, 0.0, 0.0,
                            0.0, 1.0, 0.0, 0.0,
                            0.0, 0.0, 0.5, 0.0,
                            0.0, 0.0, 0.5, 1.0
                        ],
                        h: () => [
                            0.0,
                            81.507499999999993,
                        ],
                        p: () => [
                            -1.4742, 
                            4.4744999999999999
                        ]  
                    }
                },
                {
                    name: 'dynamicUniform',
                    dynamic: true,
                    map: {
                        matrix: () => vpMatrix,
                        exaggeration: () => exaggeration,
                        zoom: () => this.map.getZoom(),
                    }
                }
            ],
            samplers: [ lSamplerDesc ],
            textures: [
                { texture: demTexture },
                { texture: borderTexture },
            ],
            storages: [
                { buffer: indexBuffer },
                { buffer: positionBuffer },
                { buffer: uvBuffer },
                { buffer: elevationBuffer },
            ],
        })

        const demBinding = Scratch.Binding.create({
            name: 'Binding (Water DEM)',
            range: () => [tIndices.length],
            uniforms: [
                {
                    name: 'staticUniform',
                    map: {
                        adjust: () => [
                            1.0, 0.0, 0.0, 0.0,
                            0.0, 1.0, 0.0, 0.0,
                            0.0, 0.0, 0.5, 0.0,
                            0.0, 0.0, 0.5, 1.0
                        ],
                        h: () => [
                            0.0,
                            81.507499999999993,
                        ],
                        p: () => [
                            -1.4742, 
                            4.4744999999999999
                        ]  
                    }
                },
                {
                    name: 'dynamicUniform',
                    dynamic: true,
                    map: {
                        matrix: () => vpMatrix,
                        exaggeration: () => exaggeration,
                        zoom: () => this.map.getZoom(),
                    }
                }
            ],
            samplers: [ lSamplerDesc ],
            textures: [
                { texture: demTexture },
                { texture: rockTexture },
                { texture: borderTexture },
                { texture: coastTexture },
            ],
            vertices: [
                { buffer: positionBuffer },
                { buffer: uvBuffer },
                { buffer: elevationBuffer },
            ],
            index: { buffer: indexBuffer },
        })

        const lastBinding = Scratch.Binding.create({
            name: 'Binding (Last)',
            range: () => [4],
            samplers: [ lSamplerDesc ],
            textures: [
                { texture: sceneTexture },
                { texture: maskTexture },
            ]
        })

        const elevationComputePipeline = Scratch.ComputePipeline.create({
            name: 'Compute Pipeline (Terrain Elevation)',
            shader: Scratch.shaderLoader.load('Shader (Terrain Elevation)', '/shaders/elevation.compute.wgsl'),
            constants: { blockSize: 16 }
        }).triggerFiniteTimes(1)

        const meshRenderPipeline = Scratch.RenderPipeline.create({
            name: 'Render Pipeline (Terrain Mesh)',
            shader: Scratch.shaderLoader.load('Shader (Terrain Mesh)', '/shaders/terrainMesh.wgsl'),
            primitive: { topology: 'line-strip' }
        })

        const demRenderPipeline = Scratch.RenderPipeline.create({
            name: 'Render Pipeline (Water DEM)',
            shader: Scratch.shaderLoader.load('Shader (Water DEM)', '/shaders/dem.wgsl'),
        })

        const maskRenderPipeline = Scratch.RenderPipeline.create({
            name: 'Render Pipeline (Mask)',
            shader: Scratch.shaderLoader.load('Shader (Water DEM)', '/shaders/mask.wgsl'),
        })

        const lastRenderPipeline = Scratch.RenderPipeline.create({
            name: 'Render Pipeline (Last)',
            shader: Scratch.shaderLoader.load('Shader (Water DEM)', '/shaders/last.wgsl'),
            primitive: { topology: 'triangle-strip' },
            colorTargetStates: [ { blend: Scratch.NormalBlending } ]
        })

        const elevationComputePass = Scratch.ComputePass.create({
            name: 'Compute Pass (Terrain Elevation)',
        })//.add(elevationComputePipeline, elevationBinding)

        computeBindings.forEach(binding => elevationComputePass.add(elevationComputePipeline, binding))

        // terrain.children.forEach(node => {
        //     elevationComputePass.add(elevationComputePipeline, node.computeBinding)
        // })
        // elevationComputePass.add(elevationComputePipeline, terrain.children[1].computeBinding)

        const demRenderPass = Scratch.RenderPass.create({
            name: 'Render Pass (Water DEM)',
            colorAttachments: [
                { colorResource: sceneTexture },
            ],
            depthStencilAttachment: { depthStencilResource: depthTexture }
        })
        if (1) {

            renderBindings.forEach(binding => demRenderPass.add(meshRenderPipeline, binding))

            // demRenderPass.add(meshRenderPipeline, meshBinding)
            // terrain.children.forEach(node => {
            //     demRenderPass.add(meshRenderPipeline, node.renderBinding)
            // })
            // demRenderPass.add(meshRenderPipeline, terrain.children[1].renderBinding)
            
        } else {
            demRenderPass.add(demRenderPipeline, demBinding)
        }

        const maskRenderPass = Scratch.RenderPass.create({
            name: 'Render Pass (Mask)',
            colorAttachments: [
                { colorResource: maskTexture },
            ],
        }).add(maskRenderPipeline, demBinding)

        const lastRenderPass = Scratch.RenderPass.create({
            name: 'Render Pass (Last)',
            colorAttachments: [
                { colorResource: screen.getCurrentCanvasTexture()}
            ]
        }).add(lastRenderPipeline, lastBinding)

        Scratch.director.addStage({
            name: 'Water DEM Shower',
            items: [
                elevationComputePass,
                demRenderPass,
                maskRenderPass,
                lastRenderPass
            ]
        })
    }

    render(gl, matrix) {

        // console.log(terrain2d)

        // console.log(cameraBoundsObject.boundary, this.map.getZoom())

        // console.log(this.map.getFreeCameraOptions(), this.map.getZoom())
        // console.log(this.map.getCenter())

        vpMatrix = new Float32Array(getMercatorMatrix(this.map.transform.clone()))
        zoom = this.map.getZoom()

        screen.swap()
        Scratch.director.show()
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

    let _farZ = Math.max(Math.pow(2, t.tileZoom), 50000.0)
    let _nearZ = Math.max(Math.pow(2, t.tileZoom - 6), 10.0)

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