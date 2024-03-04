import * as Scratch from './scratch/scratch.js'

/**
 * @typedef {object} MapOptions
 * @property {BoundingBox2D} cameraBounds
 * @property {Array[number]} cameraPos
 * @property {number} zoomLevel
 */

class BoundingBox2D {
    
    constructor(boundary) {

        this.boundary = boundary
    }

    static create(boundary) {

        if (boundary && boundary.length == 4) return new BoundingBox2D(boundary)

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
}

class TerrainNode2D {

    /**
     * @param {MapOptions} options
     * @param {number} level 
     * @param {number} id 
     * @param {TerrainNode2D} [parent]
     */
    constructor(options, level = 0, id = 0, parent = undefined) {

        this.level = level
        this.id = id
        this.parent = parent

        const horizontalNodeCount = Math.pow(2, level)
        const verticalNodeCount = Math.pow(2, level)
        this.size = [
            360.0 / horizontalNodeCount,
            180.0 / verticalNodeCount,
        ]

        this.index = [
            id % horizontalNodeCount,
            Math.floor(id / horizontalNodeCount),
        ]

        const subId = this.id % 4
        this.minLon = (this.parent ? this.parent.bBox.boundary[0] : -180.0) + (subId % 2) * this.size[0]
        this.maxLon = this.minLon + this.size[0]
        this.minLat = (this.parent ? this.parent.bBox.boundary[1] : -90.0) + Math.floor((subId / 2)) * this.size[1]
        this.maxLat = this.minLat + this.size[1]

        this.bBox = BoundingBox2D.create([
            this.minLon, this.minLat,
            this.maxLon, this.maxLat,
        ])

        /**
         * @type {Array<TerrainNode2D>}
         */
        this.children = []

        this.computeBinding = undefined
        this.renderBinding = undefined
        this.hasMeshContent = false

        this.createChildren(options)
    }

    /**
     * 
     * @param {MapOptions} options
     * @returns 
     */
    isInView(options) {

        return this.bBox.overlap(options.cameraBounds)
    }

    /**
     * 
     * @param {MapOptions} options
     * @returns 
     */
    fromCamera(options) {

        const center = this.bBox.center()
        const hFactor = Math.floor(Math.abs(center[0] - options.cameraPos[0]) / this.size[0])
        const vFactor = Math.floor(Math.abs(center[1] - options.cameraPos[1]) / this.size[1])
        const distance = Math.max(hFactor, vFactor)
        if (distance <= 1) return 0
        else if (distance <= 2) return 1
        else if (distance <= 4) return 2
        // else if (distance < 6) return 3
        // else if (distance < 7) return 4
        else return 5
        
    }

    /**
     * 
     * @param {MapOptions} options 
     * @returns 
     */
    createChildren(options) {

        if (!this.bBox.overlap(boundaryCondition)) return

        const distance = this.fromCamera(options)
        if (distance === 5) return
        else if (distance !== 0) {
            this.createBinding(options)
            return
        }

        // if (this.level === MAX_LEVEL || !this.isInView(options) || this.level > options.zoomLevel) return
        if (this.level >= MAX_LEVEL || this.level > options.zoomLevel) {
            this.createBinding(options)
            return
        }

        for (let i = 0; i < 4; i++) {

            this.children[i] = new TerrainNode2D(options, this.level + 1, 4 * this.id + i, this)
        }
    }

    /**
     * 
     * @param {MapOptions} options 
     * @returns 
     */
    createBinding(options) {

        // if (!this.bBox.overlap(boundaryCondition)) return
        // // if (!this.isInView(options) || this.level != Math.floor(options.zoomLevel)) return
        // if (!this.isInView(options)) return
        // if (this.fromCamera(options) === 5) return

        this.hasMeshContent = true

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

        this.renderBinding = Scratch.Binding.create({
            name: 'Binding (Terrain Mesh)',
            range: () => [4, indexNum / 3],
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
                        ],
                        terrainBox: () => coordinates,
                        nodeBox: () => this.bBox.boundary
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
                { texture: demTexture },
                { texture: borderTexture },
            ],
            storages: [
                { buffer: indexBuffer },
                { buffer: positionBuffer },
            ],
        })

        renderBindings.push(this.renderBinding)
        demRenderPass.add(meshRenderPipeline, this.renderBinding)
        maskRenderPass.add(maskRenderPipeline, this.renderBinding)
    }
}

let elevationComputePass
let elevationComputePipeline
let demRenderPass
let demRenderPipeline
let meshRenderPipeline
let maskRenderPass
let maskRenderPipeline
const exaggeration = 3.0

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

/**
 * @type {Scratch.Screen}
 */
let screen

// Matrix
let vpMatrix = new Float32Array(16)
let zoom = 0

const MAX_LEVEL = 14

let terrain2d = undefined

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

/**
 * @type {Array<Scratch.Binding>}
 */
let renderBindings = []

let demTexture = undefined
let borderTexture = undefined
let positionBuffer = undefined
let indexBuffer = undefined
let indexNum = 0

function init(canvas) {

    const gpuCanvas = canvas
    screen = Scratch.Screen.create({ canvas: gpuCanvas })
    console.log("?1?")
    const sceneTexture = screen.createScreenDependentTexture('Texture (DEM Scene)')
    const maskTexture = screen.createScreenDependentTexture('Texture (DEM Mask)')
    const depthTexture = screen.createScreenDependentTexture('Texture (Depth)', 'depth32float')
    demTexture = Scratch.imageLoader.load('Texture (Water DEM)', '/images/dem.png').use()
    borderTexture = Scratch.imageLoader.load('Texture (Water DEM)', '/images/border.png').use()

    const { positions, _, indices } = grid(64, 32)
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

    const lastBinding = Scratch.Binding.create({
        name: 'Binding (Last)',
        range: () => [4],
        samplers: [ lSamplerDesc ],
        textures: [
            { texture: sceneTexture },
            { texture: maskTexture },
        ]
    })

    meshRenderPipeline = Scratch.RenderPipeline.create({
        name: 'Render Pipeline (Terrain Mesh)',
        shader: Scratch.shaderLoader.load('Shader (Terrain Mesh)', '/shaders/terrainMesh.wgsl'),
        // primitive: { topology: 'line-strip' },
    })

    maskRenderPipeline = Scratch.RenderPipeline.create({
        name: 'Render Pipeline (Mask)',
        shader: Scratch.shaderLoader.load('Shader (Water DEM)', '/shaders/mask.wgsl'),
    })

    const lastRenderPipeline = Scratch.RenderPipeline.create({
        name: 'Render Pipeline (Last)',
        shader: Scratch.shaderLoader.load('Shader (Water DEM)', '/shaders/last.wgsl'),
        primitive: { topology: 'triangle-strip' },
        colorTargetStates: [ { blend: Scratch.NormalBlending } ]
    })

    demRenderPass = Scratch.RenderPass.create({
        name: 'Render Pass (Water DEM)',
        colorAttachments: [
            { colorResource: sceneTexture },
        ],
        depthStencilAttachment: { depthStencilResource: depthTexture }
    })

    maskRenderPass = Scratch.RenderPass.create({
        name: 'Render Pass (Mask)',
        colorAttachments: [
            { colorResource: maskTexture },
        ],
    })

    renderBindings.forEach(binding => demRenderPass.add(meshRenderPipeline, binding))
    renderBindings.forEach(binding => maskRenderPass.add(maskRenderPipeline, binding))

    const lastRenderPass = Scratch.RenderPass.create({
        name: 'Render Pass (Last)',
        colorAttachments: [
            { colorResource: screen.getCurrentCanvasTexture()}
        ]
    }).add(lastRenderPipeline, lastBinding)

    Scratch.director.addStage({
        name: 'Water DEM Shower',
        items: [
            demRenderPass,
            lastRenderPass
        ]
    })
    postMessage(true)
}

function render(options, matrix, zoom) {

    terrain2d = new TerrainNode2D(options, 0, 0)

    vpMatrix = matrix
    zoom = zoom

    screen.swap()
    Scratch.director.show()

    demRenderPass.empty()
    maskRenderPass.empty()

    renderBindings.forEach(binding => binding.release())
    renderBindings = []
}

self.addEventListener('message', async (e) => {

    switch (e.data.type) {
        case 'INIT':
            await Scratch.Device.Create().then((deviceInstance) => {
        
                Scratch.device.setDevice(deviceInstance.device)
            })
            init(e.data.canvas)
            break
        case 'RENDER':
            render(e.data.options, e.data.matrix, e.data.zoom)
            break
    }
})