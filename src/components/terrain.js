
export class BoundingBox2D {
    
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

export class TerrainNode2D {

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

        this.size = 180.0 / Math.pow(2, level)

        this.index = [
            id % Math.pow(2, level),
            Math.floor(id / Math.pow(2, level)),
        ]

        const subId = this.id % 4
        const minLon = (this.parent ? this.parent.bBox.boundary[0] : 0.0) + (subId % 2) * this.size
        const maxLon = this.minLon + this.size
        const minLat = (this.parent ? this.parent.bBox.boundary[1] : -90.0) + Math.floor((subId / 2)) * this.size
        const maxLat = this.minLat + this.size

        this.bBox = BoundingBox2D.create([
            minLon, minLat,
            maxLon, maxLat,
        ])

        /**
         * @type {Array<TerrainNode2D>}
         */
        this.children = []

        this.renderBinding = undefined
        this.hasMeshContent = false

        this.createChildren(options)
    }

    release() {

        this.children.forEach(node => node.release())
        
        // if (this.renderBinding) {
        //     this.renderBinding.uniforms[0].ref.map.nodeBox = undefined
        //     bindingPool.push(this.renderBinding)
        // }
        this.renderBinding && (this.renderBinding = this.renderBinding.release())
        // this.renderBinding = null
        this.level = null
        this.id = null
        this.parent = null
        this.size = null
        this.index = []
        this.minLon = null
        this.minLat = null
        this.maxLon = null
        this.maxLat = null
        this.bBox.boundary = null
        this.bBox = null
        this.hasMeshContent = null
        this.children = []
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
     * @param {MapOptions} options
     * @returns 
     */
    fromCamera(options) {

        const center = this.bBox.center()
        const hFactor = Math.floor(Math.abs(center[0] - options.cameraPos[0]) / this.size)
        const vFactor = Math.floor(Math.abs(center[1] - options.cameraPos[1]) / this.size)
        const distance = Math.max(hFactor, vFactor)
        if (distance <= 1) return 0
        else if (distance <= 2) return 1
        else if (distance <= 4) return 2
        // else if (distance < 6) return 3
        // else if (distance < 7) return 4
        else return 5
        
    }

    /**
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
     * @param {MapOptions} options 
     * @returns 
     */
    createBinding(options) {

        this.hasMeshContent = true

        // if (bindingPool.length) {
        //     this.renderBinding = bindingPool.pop()
        //     this.renderBinding.uniforms[0].ref.map.nodeBox = () => this.bBox.boundary
        // }
        // else 
        this.renderBinding = Scratch.Binding.create({
            name: 'Binding (Terrain node)',
            range: () => [4, indexNum / 3],
            uniforms: [
                {
                    name: 'nodeUniform',
                    map: {
                        nodeBox: () => this.bBox.boundary
                    }
                },
            ],
            sharedUniforms: [
                { buffer: gStaticBuffer },
                { buffer: gDynamicBuffer }
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
    }
}