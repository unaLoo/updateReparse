struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32,
    @location(0) position: vec2f,
};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(perspective, center) depth: f32,
    @location(1) @interpolate(perspective, center) texcoords: vec2f,
    @location(2) alpha: f32,
    @location(3) z: f32,
};

struct StaticUniformBlock {
    adjust: mat4x4f,
    p: vec2f,
    h: vec2f,
    terrainBox: vec4f,
    nodeBox: vec4f,
};

struct DynamicUniformBlock {
    matrix: mat4x4f,
    exaggeration: f32,
    zoom: f32,
};

// Uniform Bindings
@group(0) @binding(0) var<uniform> staticUniform: StaticUniformBlock;
@group(0) @binding(1) var<uniform> dynamicUniform: DynamicUniformBlock;

// Texture Bindings
@group(1) @binding(0) var lsampler: sampler;
@group(1) @binding(1) var demTexture: texture_2d<f32>;
@group(1) @binding(2) var rockTexture: texture_2d<f32>;
@group(1) @binding(3) var borderTexture: texture_2d<f32>;
@group(1) @binding(4) var coastTexture: texture_2d<f32>;

const PI = 3.141592653;

fn calcWebMercatorPos(pos: vec2f) -> vec2f {

    let lon = (180.0 + pos.x) / 360.0;
    let lat = (180.0 - (180.0 / PI * log(tan(PI / 4.0 + pos.y * PI / 360.0)))) / 360.0;
    return vec2f(lon, lat);
}

fn calcUVFromPos(pos: vec2f) -> vec2f {

    let u = (pos.x - staticUniform.terrainBox[0]) / (staticUniform.terrainBox[2] - staticUniform.terrainBox[0]);
    let v = (pos.y - staticUniform.terrainBox[1]) / (staticUniform.terrainBox[3] - staticUniform.terrainBox[1]);
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

    let u = mix(0.0, 1.0, vsInput.uv.x);
    let v = mix(0.0, 1.0, vsInput.uv.y);

    let x = vsInput.position.x;
    let y = vsInput.position.y;
    let z = vsInput.elevation;

    let dim = vec2f(textureDimensions(borderTexture, 0).xy);
    let texcoords = vec2f(u, v) * dim;
    let borderFactor = linearSampling(borderTexture, texcoords, dim).r;

    var output: VertexOutput;
    output.position = staticUniform.adjust * dynamicUniform.matrix * vec4f(x, y, z, 1.0);
    output.depth = 1000000.0 * z  / dynamicUniform.exaggeration / (staticUniform.p.y - staticUniform.h.y);
    output.texcoords = vec2f(u, v);
    output.alpha = borderFactor;
    output.z = z;

    return output;
}

@fragment
fn fMain(fsInput: VertexOutput) -> @location(0) vec4f {

    let dim = vec2f(textureDimensions(rockTexture, 0).xy);
    let rockColor = textureSample(rockTexture, lsampler, fsInput.texcoords * vec2f(20.0 * 1024.0 / 558.0, 20.0)).rgb;
    let coastColor = textureSample(coastTexture, lsampler, fsInput.texcoords * vec2f(20.0 * 1024.0 / 558.0, 20.0)).rgb;

    var depth = fsInput.depth;

    // if (fsInput.alpha == 0.0) {
    //     discard;
    // }

    // if (fsInput.z >= 0.0) {
    //     return vec4f(coastColor, 1.0);
    // }
    // return vec4f(rockColor, 0.2) * (1.0 - depth);
    return vec4f(depth);
}