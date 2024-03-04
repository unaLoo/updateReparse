struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32,
};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) alpha: f32,
    @location(1) depth: f32,
    @location(2) level: f32,
};

struct StaticUniformBlock {
    adjust: mat4x4f,
    terrainBox: vec4f,
    e: vec2f,
};

struct NodeUniformBlock {

    nodeBox: vec4f,
    level: u32,
}

struct DynamicUniformBlock {
    matrix: mat4x4f,
    exaggeration: f32,
    zoom: f32,
};

// Uniform Bindings
// @group(0) @binding(0) var<uniform> nodeUniform: NodeUniformBlock;
@group(0) @binding(0) var<uniform> staticUniform: StaticUniformBlock;
@group(0) @binding(1) var<uniform> dynamicUniform: DynamicUniformBlock;

@group(1) @binding(0) var<storage> indices: array<u32>;
@group(1) @binding(1) var<storage> positions: array<f32>;
@group(1) @binding(2) var<storage> level: array<u32>;
@group(1) @binding(3) var<storage> box: array<f32>;

// Texture Bindings
@group(2) @binding(0) var lsampler: sampler;
@group(2) @binding(1) var demTexture: texture_2d<f32>;
@group(2) @binding(2) var borderTexture: texture_2d<f32>;

const PI = 3.141592653;

fn calcWebMercatorCoord(coord: vec2f) -> vec2f {

    let lon = (180.0 + coord.x) / 360.0;
    let lat = (180.0 - (180.0 / PI * log(tan(PI / 4.0 + coord.y * PI / 360.0)))) / 360.0;
    return vec2f(lon, lat);
}

fn calcUVFromCoord(coord: vec2f) -> vec2f {

    let u = (coord.x - staticUniform.terrainBox[0]) / (staticUniform.terrainBox[2] - staticUniform.terrainBox[0]);
    let v = (coord.y - staticUniform.terrainBox[1]) / (staticUniform.terrainBox[3] - staticUniform.terrainBox[1]);
    return vec2f(u, v);
}

fn uvCorrection(uv: vec2f, dim: vec2f) -> vec2f {

    return clamp(uv, vec2f(0.0), dim);
}

fn linearSampling(texture: texture_2d<f32>, uv: vec2f, dim: vec2f) -> vec4f {

    let tl = textureLoad(texture, vec2i(uv), 0);
    let tr = textureLoad(texture, vec2i(uvCorrection(uv + vec2f(1.0, 0.0), dim).xy), 0);
    let bl = textureLoad(texture, vec2i(uvCorrection(uv + vec2f(0.0, 1.0), dim).xy), 0);
    let br = textureLoad(texture, vec2i(uvCorrection(uv + vec2f(1.0, 1.0), dim).xy), 0);

    let mix_x = fract(uv.x);
    let mix_y = fract(uv.y);
    let top = mix(tl, tr, mix_x);
    let bottom = mix(bl, br, mix_x);
    return mix(top, bottom, mix_y);
}

fn IDW(texture: texture_2d<f32>, uv: vec2f, dim: vec2f, step: i32, p: f32) -> vec4f {

    let steps = vec2i(step, i32(ceil(f32(step) * dim.y / dim.x)));
    var weightSum = 0.0;
    var value = vec4f(0.0);
    for (var i = -steps.x; i < steps.x; i++ ) {
        for (var j = -steps.y; j < steps.y; j++) {

            let offset = vec2f(f32(i), f32(j));
            let distance = length(offset);
            let w = 1.0 / pow(select(distance, 1.0, distance == 0.0), p);

            let texcoords = uv + offset;
            value += linearSampling(texture, texcoords, dim) * w;
            weightSum += w;
        }
    }

    return value / weightSum;
}

@vertex
fn vMain(vsInput: VertexInput) -> VertexOutput {

    // let vertexID = vsInput.instanceIndex * 3 + vsInput.vertexIndex % 3;
    let index = indices[vsInput.vertexIndex];
    let x = positions[index * 2 + 0];
    let y = positions[index * 2 + 1];

    let coord = vec2f(
        mix(box[vsInput.instanceIndex * 4 + 0], box[vsInput.instanceIndex * 4 + 2], x),
        clamp(mix(box[vsInput.instanceIndex * 4 + 1], box[vsInput.instanceIndex * 4 + 3], y), -85.0, 85.0),
    );
    // let coord = vec2f(
    //     mix(nodeUniform.nodeBox[0], nodeUniform.nodeBox[2], x),
    //     clamp(mix(nodeUniform.nodeBox[1], nodeUniform.nodeBox[3], y), -85.0, 85.0),
    // );

    var z: f32;
    var depth: f32;
    var borderFactor: f32;
    if ((coord.x > staticUniform.terrainBox[0] && coord.x < staticUniform.terrainBox[2]) && (coord.y > staticUniform.terrainBox[1] && coord.y < staticUniform.terrainBox[3])) {

        let uv = calcUVFromCoord(coord);
        let dim = vec2f(textureDimensions(demTexture, 0).xy);

        let eleavation = mix(staticUniform.e.x, staticUniform.e.y, IDW(demTexture, uv * dim, dim, 3, 1).r);
        z = dynamicUniform.exaggeration * eleavation / 1000000.0;
        depth = (eleavation - staticUniform.e.x) / (staticUniform.e.y - staticUniform.e.x);
        borderFactor = linearSampling(borderTexture, uv * dim, dim).r;
    } else {
        z = 0.0;
        depth = 1.0;
        borderFactor = 0.0;
    }

    var output: VertexOutput;
    output.position = staticUniform.adjust * dynamicUniform.matrix * vec4f(calcWebMercatorCoord(coord), z, 1.0);
    output.alpha = borderFactor;
    output.depth = depth;
    output.level = f32(level[vsInput.instanceIndex]);
    return output;
}

fn colorMap(index: u32) -> vec3f {

    let palette = array<vec3f, 11> (
        vec3f(158.0, 1.0, 66.0),
        vec3f(213.0, 62.0, 79.0),
        vec3f(244.0, 109.0, 67.0),
        vec3f(253.0, 174.0, 97.0),
        vec3f(254.0, 224.0, 139.0),
        vec3f(255.0, 255.0, 191.0),
        vec3f(230.0, 245.0, 152.0),
        vec3f(171.0, 221.0, 164.0),
        vec3f(102.0, 194.0, 165.0),
        vec3f(50.0, 136.0, 189.0),
        vec3f(94.0, 79.0, 162.0),
    );

    return palette[index] / 255.0;
}

@fragment
fn fMain(fsInput: VertexOutput) -> @location(0) vec4f {
    
    let level = clamp(14 - u32(fsInput.level), 0, 10);

    return vec4f(colorMap(level), 1.0 - fsInput.depth);


    // return vec4f(1.0 - fsInput.depth);
    // return vec4f(0.5);
}