// Data Size Constraints
export class FlowFieldController {
    lineNum;
    segmentNum;
    fullLife;
    progressRate;
    speedFactor;
    dropRate;
    dropRateBump;
    fillWidth;
    aaWidth;
    colorScheme;
    isUnsteady;
    content;
    primitive;
    platform;
    stop;
    tick;

    constraints;
    
    constructor(constraints) {
        this.lineNum = 262144;
        this.segmentNum = 16;
        this.fullLife = this.segmentNum * 10;
        this.progressRate = 0.0;
        this.speedFactor = 1.0;
        this.dropRate = 0.003;
        this.dropRateBump = 0.001;
        this.fillWidth = 1.0;
        this.aaWidth = 2.0;
        this.colorScheme = 0;
        this.isUnsteady = true;
        this.content = "none";
        this.primitive = 0;
        this.platform = "WebGPU";
        this.stop = false;
        this.tick = true;

        if (constraints) {
            this.constraints = constraints;
        } else {
            this.constraints = {
                MAX_TEXTURE_SIZE: 0.0,
                MAX_LINE_NUM: 0.0,
                MAX_SEGMENT_NUM: 0.0,
                MAX_DORP_RATE: 0.0,
                MAX_DORP_RATE_BUMP: 0.0
            }
        }
    }

    Create(constraints) {
        return new FlowFieldController(constraints);
    }

    ToUniformView() {
        return {
            particleNum: this.lineNum,
            segmentNum: this.segmentNum,
            dropRate: this.dropRate,
            dropRateBump: this.dropRateBump,
            speedFactor: this.speedFactor,
            fillWidth: this.fillWidth,
            aaWidth: this.aaWidth,
        }
    }
}