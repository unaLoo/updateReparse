// Custom layer implemented as ES6 class
import { tickLogic, init, showFlowField } from './n-flowLayer.js'
import * as Scratch from './scratch/scratch.js'

export default class nFlowLayer {
    constructor() {
        this.id = 'nFlowLayer';
        this.type = 'custom';
        this.renderingMode = '2d';
    }

    async onAdd(map, gl) {

        this.map = map

        const gpuCanvas = document.getElementById('WebGPUFrame')
        screen = Scratch.Screen.create({ canvas: gpuCanvas })
        const sceneTexture = screen.createScreenDependentTexture(' Scene Texture', undefined, [2, 2])
        const { simulationPass, renderPass } = await init(sceneTexture)

        Scratch.director.addStage({
            name: 'Flow Field Shower',
            items: [
                simulationPass,
                renderPass,
            ],
            visibility: true,
        })

    }

    render(gl, matrix) {


        tickLogic(matrix)
        // tick(mapMatrix, [mercatorCenter.x, mercatorCenter.y])

        // DEM layer tick
        Scratch.director.tick()
    }
}

