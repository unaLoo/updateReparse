import mapboxgl from 'mapbox-gl'
import * as Scratch from './scratch/scratch.js'
import { mat4, vec4 } from 'gl-matrix'
import * as turf from '@turf/turf'


const waterColor = [3.0 / 255.0, 38.0 / 255.0, 36.0 / 255.0]
const coordinates = [
    120.0437360613468201,
    121.9662324011692220,
    32.0840108580467813,
    31.1739019522094871,
]

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

const maxLodLevel = 5
class TerrainNode {

    /**
     * @param {Array<number>} bbox [minX, minY, maxX, maxY]
     * @param {number} [lodLevel=0] 
     * @param {{units: turf.Units}} [options = {units: 'meters'}] 
     */
    constructor(bbox, lodLevel = 0, options = {units: 'meters'}) {

        this.bbox = bbox
        this.lodLevel = lodLevel
        this.options = options
        
        this.tl = turf.point([bbox[0], bbox[3]])
        this.tr = turf.point([bbox[2], bbox[3]])
        this.bl = turf.point([bbox[0], bbox[1]])
        this.br = turf.point([bbox[2], bbox[1]])

        this.width = turf.distance(this.tl, this.tr, this.options)
        this.height = turf.distance(this.tl, this.bl, this.options)

        /**
         * @type {Array<TerrainNode>}
         */
        this.children = []
        if (this.lodLevel < maxLodLevel) this.makeQuadNodes()
    }

    makeQuadNodes() {

        const subWidth = this.width / 2
        const subHeight = this.height / 2

        for(let i = 0; i < 2; i++) {
            for (let j = 0; j < 2; j++) {
                let subTl = turf.destination(this.tl, subWidth * i, 90, this.options)
                let subTr = turf.destination(this.tl, subWidth * (i + 1), 90, this.options)
                let subBl = turf.destination(this.tl, subHeight * j, 180, this.options)
                let subBr = turf.destination(this.tl, subHeight * (j + 1), 180, this.options)

                let subBBox = [
                    subTl.geometry.coordinates[0],
                    subBl.geometry.coordinates[1],
                    subBr.geometry.coordinates[0],
                    subTr.geometry.coordinates[1],
                ]

                this.children.push(new TerrainNode(subBBox, this.lodLevel + 1, this.options))
            }
        }
    }
}

class Terrain {

    /**
     * @param {Array<number>} bbox [minX, minY, maxX, maxY]
     * @param {number} rootTileSize
     * @param {{units: turf.Units}} [options = {units: 'meters'}] 
     */
    constructor(bbox, rootTileSize, options = {units: 'meters'}) {

        this.bbox = bbox
        this.rootTileSize = rootTileSize
        this.lodLevel = -1
        this.options = options
        
        this.tl = turf.point([bbox[0], bbox[3]])
        this.tr = turf.point([bbox[2], bbox[3]])
        this.bl = turf.point([bbox[0], bbox[1]])
        this.br = turf.point([bbox[2], bbox[1]])

        this.width = turf.distance(this.tl, this.tr, this.options)
        this.height = turf.distance(this.tl, this.bl, this.options)

        this.horizontalTileNum = Math.ceil(this.width / this.rootTileSize)
        this.verticalTileNum = Math.ceil(this.height / this.rootTileSize)
        console.log(this.horizontalTileNum, this.verticalTileNum)

        /**
         * @type {Array<TerrainNode>}
         */
        this.children = []
        for (let i = 0; i < this.horizontalTileNum; i++) {
            for (let j = 0; j < this.verticalTileNum; j++) {

                let subTl = turf.destination(this.tl, rootTileSize * i, 90, this.options)
                let subTr = turf.destination(this.tl, rootTileSize * (i + 1), 90, this.options)
                let subBl = turf.destination(this.tl, rootTileSize * j, 180, this.options)
                let subBr = turf.destination(this.tl, rootTileSize * (j + 1), 180, this.options)

                let subBBox = [
                    subTl.geometry.coordinates[0],
                    subBl.geometry.coordinates[1],
                    subBr.geometry.coordinates[0],
                    subTr.geometry.coordinates[1],
                ]

                this.children.push(new TerrainNode(subBBox, this.lodLevel + 1, this.options))
            }
        }
    }
}

export class DEMLayer {
    
    constructor() {

        this.id = 'DemLayer'
        this.type = 'custom'
        this.renderingMode = '3d'
        this.map = undefined
    }

    onAdd(map, gl) {

        this.map = map

        // this.map.setFreeCameraOptions({
        //     orientation: [0, 0, -0.15287596034368486, 0.988245384886262],
        //     position: {x: 0.8366379089483701, y: 0.40705321942319284, z: 0.0011039879844904241}
        // })
        // this.map.setZoom(12)

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
        const terrain = new Terrain(bbox, 20000, { units: 'meters' })
        console.log(terrain)
        const terrainWidth = turf.distance(pTL, pTR, { units: 'meters' })
        const terrainHeight = turf.distance(pTL, pBL, { units: 'meters' })
        const nPTR = turf.destination(pTL, terrainWidth, 90, { units: 'meters' })
        // console.log(pTR.geometry.coordinates, nPTR.geometry.coordinates)
        const tGrid = turf.triangleGrid([coordinates[0], coordinates[3], coordinates[1], coordinates[2]], 0.25, { units: 'kilometers' })
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

            // feature.geometry.coordinates[0].forEach(coord => {
            // })
        })
        // const mTL = mapboxgl.MercatorCoordinate.fromLngLat(pTL)
        // const terrainWidth = pTL.distanceTo(pTR)
        // const terrainHeight = pTL.distanceTo(pBL)
        // const offset = [terrainWidth * mTL.meterInMercatorCoordinateUnits(), terrainHeight * mTL.meterInMercatorCoordinateUnits()]
        // const mBR = new mapboxgl.MercatorCoordinate(mTL.x + offset[0], mTL.y + offset[1])

        const gpuCanvas = document.getElementById('WebGPUFrame')
        screen = Scratch.Screen.create({ canvas: gpuCanvas })
        const sceneTexture = screen.createScreenDependentTexture('Texture (DEM Scene)')
        const maskTexture = screen.createScreenDependentTexture('Texture (DEM Mask)')
        const depthTexture = screen.createScreenDependentTexture('Texture (Depth)', 'depth32float')
        const demTexture = Scratch.imageLoader.load('Texture (Water DEM)', '/images/dem.png')
        const borderTexture = Scratch.imageLoader.load('Texture (Water DEM)', '/images/border.png')
        const rockTexture = Scratch.imageLoader.load('Texture (Rocks)', '/images/river/diff_4k.png', true)
        const coastTexture = Scratch.imageLoader.load('Texture (Rocks)', '/images/coast/diff_4k.png', true)

        // const {positions, uvs, indices} = grid(1024, 558)
        // const {positions, uvs, indices} = grid(558, 1024)
        // for (let i = 0; i < positions.length; i += 2) {
        //     const lon = mix(coordinates[0], coordinates[1], positions[i])
        //     const lat = mix(coordinates[2], coordinates[3], positions[i + 1])

        //     const mercator = mapboxgl.MercatorCoordinate.fromLngLat([lon, lat])
        //     positions[i] = mercator.x
        //     positions[i + 1] = mercator.y
        // }

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

        let exaggeration = 3.0
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
        }).add(elevationComputePipeline, elevationBinding)

        const demRenderPass = Scratch.RenderPass.create({
            name: 'Render Pass (Water DEM)',
            colorAttachments: [
                { colorResource: sceneTexture },
            ],
            depthStencilAttachment: { depthStencilResource: depthTexture }
        })
        if (1) {
            demRenderPass.add(meshRenderPipeline, meshBinding)
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

        // console.log(this.map.getFreeCameraOptions(), this.map.getZoom())
        // console.log(this.map.getCenter())

        vpMatrix = new Float32Array(getMercatorMatrix(this.map.transform.clone()))

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