struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32,
};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(perspective, center) ph: vec2f,
};

struct StaticUniformBlock {
    adjust: mat4x4f,
    p: vec2f,
    h: vec2f,
    terrainBox: vec4f,
    nodeBox: vec4f,
    dist: f32,
};

struct DynamicUniformBlock {
    matrix: mat4x4f,
    exaggeration: f32,
    zoom: f32,
};

// Uniform Bindings
@group(0) @binding(0) var<uniform> staticUniform: StaticUniformBlock;
@group(0) @binding(1) var<uniform> dynamicUniform: DynamicUniformBlock;

@group(1) @binding(0) var<storage> indices: array<u32>;
@group(1) @binding(1) var<storage> positions: array<f32>;

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

    // let dim = vec2f(textureDimensions(demTexture, 0).xy);
    // let u = mix(0.0, 1.0, vsInput.uv.x) + 0.5 / dim.x;
    // let v = mix(0.0, 1.0, vsInput.uv.y) + 0.5 / dim.x;
    // let texcoords = vec2f(u, v) * dim;
    // let ph = textureLoad(demTexture, vec2i(texcoords), 0).rg;

    // var output: VertexOutput;
    // output.position = staticUniform.adjust * dynamicUniform.matrix * vec4f(vsInput.position, select(0.0, vsInput.elevation, dynamicUniform.zoom > 15.0), 1.0);
    // output.texcoords = vec2f(u, v);
    // output.ph = ph;

    // return output;

    let vertexID = vsInput.instanceIndex * 3 + vsInput.vertexIndex % 3;
    let index = indices[vertexID];

    let x = positions[index * 2 + 0];
    let y = positions[index * 2 + 1];
    let coord = vec2f(
        mix(staticUniform.nodeBox[0], staticUniform.nodeBox[2], x),
        clamp(mix(staticUniform.nodeBox[1], staticUniform.nodeBox[3], y), -85.0, 85.0),
    );

    let uv = calcUVFromCoord(coord);
    let dim = vec2f(textureDimensions(demTexture, 0).xy);
    
    // let ph =  textureLoad(demTexture, vec2i((uv * dim)), 0).rg;
    let ph = IDW(demTexture, uv * dim, dim, 3, 1);
    let p = mix(staticUniform.p.x, staticUniform.p.y, ph.x);
    let h = mix(staticUniform.h.x, staticUniform.h.y, ph.y);
    let z = dynamicUniform.exaggeration * (p - h) / 1000000.0;

    var output: VertexOutput;
    output.position = staticUniform.adjust * dynamicUniform.matrix * vec4f(calcWebMercatorCoord(coord), select(0.0, z, dynamicUniform.zoom > 15.0), 1.0);
    output.ph = ph.rg;

    return output;
}

@fragment
fn fMain(fsInput: VertexOutput) -> @location(0) vec4f {

    var color = select(1.0, 0.0, fsInput.ph.x == 0.0 && fsInput.ph.y == 0.0);

    return vec4f(color);
}