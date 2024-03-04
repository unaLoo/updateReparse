struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(perspective, center) speedRate: f32,
    @location(1) @interpolate(perspective, center) edgeParam: f32,
    @location(2) @interpolate(perspective, center) alphaDegree: f32,
}

struct StaticUniformBlock {
    flowBoundary: vec4f, // vec4f(uMin, vMin, uMax, vMax)
    maxParticleNum: f32,
    maxSegmentNum: f32,
    fullLife: f32,
    groupSize: vec2u,
}

struct ControllerUniformBlock {
    particleNum: u32,
    segmentNum: f32,
    dropRate: f32,
    dropRateBump: f32,
    speedFactor: f32,
    fillWidth: f32,
    aaWidth: f32,
}

struct FrameUniformBlock {
    progress: f32,
    randomSeed: f32,
    startStorageIndex: f32,
    startReadIndex: f32,
    canvasSize: vec2u,
    u_centerHigh: vec2f,
    u_centerLow: vec2f,
    u_matrix: mat4x4f
}

// Uniform bindings
@group(0) @binding(0) var<uniform> staticUniform: StaticUniformBlock;
@group(0) @binding(1) var<uniform> controllerUniform: ControllerUniformBlock;
@group(0) @binding(2) var<uniform> frameUniform: FrameUniformBlock;

// Texture bindings
@group(1) @binding(0) var fTexture1: texture_2d<f32>;
@group(1) @binding(1) var fTexture2: texture_2d<f32>;
@group(1) @binding(2) var seedingTexture: texture_2d<f32>;
@group(1) @binding(3) var transformHighTexture: texture_2d<f32>;
@group(1) @binding(4) var transformLowTexture: texture_2d<f32>;

// Storage bindings
@group(2) @binding(0) var<storage> data_v: array<f32>;
@group(2) @binding(1) var<storage> indexArray_v: array<u32>;
@group(2) @binding(2) var<storage> attributes: array<f32>;

fn get_address(nodeIndex: u32, instanceIndex: u32) -> u32 {

    // Calculate the blockIndex of the current node
    let blockIndex = (u32(frameUniform.startStorageIndex) - nodeIndex + u32(staticUniform.maxSegmentNum)) % u32(staticUniform.maxSegmentNum);

    // Calculate original address of the block
    let blockAddress = blockIndex * u32(staticUniform.maxParticleNum);

    // Calculate address of the current node
    let nodeAddress = blockAddress + indexArray_v[instanceIndex];

    return nodeAddress;
}

fn translateRelativeToEye(high: vec2f, low: vec2f) -> vec2f {
    let highDiff = high - frameUniform.u_centerHigh;
    let lowDiff = low - frameUniform.u_centerLow;

    return highDiff + lowDiff;
}

fn sampleGeoPosition(pos: vec2f) -> vec2f {

    let textureSize = textureDimensions(transformHighTexture, 0);
    let uv: vec2f = pos * vec2f(textureSize);
    var f = fract(uv);
    var parity = vec2i(select(-1, 1, f.x >= 0.5), select(-1, 1, f.y >= 0.5));
    let uv0 = vec2i(uv);
    let uv1 = uv0 + vec2i(parity.x, 0);
    let uv2 = uv0 + vec2i(0, parity.y);
    let uv3 = uv0 + vec2i(parity.x, parity.y);

    let highGeoPos0 = textureLoad(transformHighTexture, uv0, 0).xy;
    let highGeoPos1 = textureLoad(transformHighTexture, uv1, 0).xy;
    let highGeoPos2 = textureLoad(transformHighTexture, uv2, 0).xy;
    let highGeoPos3 = textureLoad(transformHighTexture, uv3, 0).xy;
    let lowGeoPos0 = textureLoad(transformLowTexture, uv0, 0).xy;
    let lowGeoPos1 = textureLoad(transformLowTexture, uv1, 0).xy;
    let lowGeoPos2 = textureLoad(transformLowTexture, uv2, 0).xy;
    let lowGeoPos3 = textureLoad(transformLowTexture, uv3, 0).xy;
    let geoPos0 = translateRelativeToEye(highGeoPos0, lowGeoPos0);
    let geoPos1 = translateRelativeToEye(highGeoPos1, lowGeoPos1);
    let geoPos2 = translateRelativeToEye(highGeoPos2, lowGeoPos2);
    let geoPos3 = translateRelativeToEye(highGeoPos3, lowGeoPos3);
    
    // let geoPos0 = textureLoad(transformTexture, uv0, 0).xy;
    // let geoPos1 = textureLoad(transformTexture, uv1, 0).xy;
    // let geoPos2 = textureLoad(transformTexture, uv2, 0).xy;
    // let geoPos3 = textureLoad(transformTexture, uv3, 0).xy;

    let lerp = abs(f - vec2f(0.5));
    // return mix(mix(highGeoPos0.xy, highGeoPos1.xy, lerp.x), mix(highGeoPos2, highGeoPos3, lerp.x), lerp.y);
    return mix(mix(geoPos0.xy, geoPos1.xy, lerp.x), mix(geoPos2, geoPos3, lerp.x), lerp.y);
}

fn ReCoordinate(pos: vec2f) -> vec4f {

    // let highGeoPos = sampleGeoPosition(pos, transformHighTexture);
    // let lowGeoPos = sampleGeoPosition(pos, transformLowTexture);
    // let geoPos = translateRelativeToEye(highGeoPos, lowGeoPos);
    let geoPos = sampleGeoPosition(pos);

    let res = frameUniform.u_matrix * vec4f(geoPos, 0.0, 1.0);
    return res;
}

fn transfer_to_clip_space(pos: vec2f) -> vec4f {
    
    return ReCoordinate(pos);
}

fn get_clip_position(address: u32) -> vec4f {

    return transfer_to_clip_space(vec2f(data_v[2 * address], data_v[2 * address + 1]));
}

fn get_vector(beginVertex: vec2f, endVertex: vec2f) -> vec2f {
    
    return normalize(endVertex - beginVertex);
}

@vertex
fn vMain(vsInput: VertexInput) -> VertexOutput {

    // Get screen positions from particle pool
    let parity = f32(vsInput.vertexIndex % 2);
    let currentNode = vsInput.vertexIndex / 2;
    let nextNode = currentNode + 1;
    let c_address = get_address(currentNode, vsInput.instanceIndex);
    let n_address = get_address(nextNode, vsInput.instanceIndex);
    let cn_pos_CS = get_clip_position(c_address);
    let nn_pos_CS = get_clip_position(n_address);
    let cn_pos_SS = cn_pos_CS.xy / cn_pos_CS.w;
    let nn_pos_SS = nn_pos_CS.xy / nn_pos_CS.w;

    // Calculate the screen offset
    let lineWidth = (controllerUniform.fillWidth + controllerUniform.aaWidth * 2.0);
    // let cn_vector = get_vector(cn_pos_SS, nn_pos_SS);
    let cn_vector = select(get_vector(cn_pos_SS, nn_pos_SS),normalize(vec2f(1.0, 1.0)), distance(cn_pos_SS, nn_pos_SS) < 0.00001);
    let screenOffset = lineWidth / 2.0;

    // Translate current vertex position
    let view = vec3f(0.0, 0.0, 1.0);
    let v_offset = normalize(cross(view, vec3f(cn_vector, 0.0))).xy * mix(1.0, -1.0, parity);
    let vertexPos_SS = cn_pos_SS + v_offset * screenOffset / vec2f(frameUniform.canvasSize);

    ////////////////////
    // Calculate vertex position in screen coordinates
    let vertexPos_CS = vertexPos_SS * cn_pos_CS.w;
    let segmentRate = f32(currentNode) / controllerUniform.segmentNum;

    var output: VertexOutput;
    output.position = vec4f(vertexPos_CS, 0.0, cn_pos_CS.w);

    output.speedRate = attributes[c_address];
    output.edgeParam = 2.0 * parity - 1.0;
    output.alphaDegree = 1.0 - segmentRate;

    return output;
}

fn colorFromInt(color: u32) -> vec3f {
    
    let b = f32(color & 0xFF) / 255.0;
    let g = f32((color >> 8) & 0xFF) / 255.0;
    let r = f32((color >> 16) & 0xFF) / 255.0;

    return vec3f(r, g, b);
}

fn velocityColor(speed: f32, rampColors: array<u32, 8>) -> vec3f {
    
    // let bottomIndex = floor(speed * 10.0);
    // let topIndex = mix(bottomIndex + 1.0, 7.0, step(6.0, bottomIndex));
    // let interval = mix(1.0, 4.0, step(6.0, bottomIndex));
    let bottomIndex = floor(speed * 8.0);
    let topIndex = ceil(speed * 8.0);
    let interval = speed * 8.0 - bottomIndex;

    let slowColor = colorFromInt(rampColors[u32(bottomIndex)]);
    let fastColor = colorFromInt(rampColors[u32(topIndex)]);

    // return mix(slowColor, fastColor, (speed * 10.0 - f32(bottomIndex)) / interval);
    return mix(slowColor, fastColor, interval);
}

fn getAlpha(param: f32) -> f32 {

    if (controllerUniform.aaWidth == 0.0) {
        return 1.0;
    }
    else {
        return 1.0 - clamp((param * (0.5 * controllerUniform.fillWidth + controllerUniform.aaWidth) - 0.5 * controllerUniform.fillWidth) / controllerUniform.aaWidth, 0.0, 1.0);
        // return 1.0 - sin(clamp((param * (0.5 * controllerUniform.fillWidth + controllerUniform.aaWidth) - 0.5 * controllerUniform.fillWidth) / controllerUniform.aaWidth, 0.0, 1.0) * 2.0 / 3.141592653);
    }
}

@fragment
fn fMain(fsInput: VertexOutput) -> @location(0) vec4f {

    let rampColors0 = array<u32, 8>(
        0x3288bd,
        0x66c2a5,
        0xabdda4,
        0xe6f598,
        0xfee08b,
        0xfdae61,
        0xf46d43,
        0xd53e4f
    );

    let alpha = getAlpha(abs(fsInput.edgeParam));
    let color = velocityColor(fsInput.speedRate, rampColors0);
    // let color1 = colorFromInt(rampColors0[u32(fsInput.speedRate * 8)]);

    return vec4f(color, 1.0) * 0.5 * alpha * fsInput.alphaDegree;
    // let waterColor = vec3f(3.0 / 255.0, 38.0 / 255.0, 36.0 / 255.0);
    // return vec4f(waterColor * 1.4, 1.0) * alpha * fsInput.alphaDegree;
    // return vec4f(vec3f(0.6), 0.6) * alpha * fsInput.alphaDegree;
}