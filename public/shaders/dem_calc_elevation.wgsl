struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
    @location(0) position: vec2f,
    @location(1) uv: vec2f,
    @location(2) elevation: f32,
};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(perspective, center) depth: f32,
    @location(1) @interpolate(perspective, center) alpha: f32,
};

struct FragementOutput {
    @location(0) scene: vec4f,
    @location(1) mask: vec4f,
};

struct StaticUniformBlock {
    extent: vec4f,
    adjust: mat4x4f,
    p: vec2f,
    h: vec2f,
};

struct DynamicUniformBlock {
    matrix: mat4x4f,
    exaggeration: f32,
};

// Uniform Bindings
@group(0) @binding(0) var<uniform> staticUniform: StaticUniformBlock;
@group(0) @binding(1) var<uniform> dynamicUniform: DynamicUniformBlock;

// Texture Bindings
@group(1) @binding(0) var lsampler: sampler;
@group(1) @binding(1) var demTexture: texture_2d<f32>;
@group(1) @binding(2) var borderTexture: texture_2d<f32>;

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

fn cubicInterpolate(p0: vec4<f32>, p1: vec4<f32>, p2: vec4<f32>, p3: vec4<f32>, t: f32) -> vec4<f32> {

    let a = (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * 0.5;
    let b = (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * 0.5;
    let c = (-p0 + p2) * 0.5;
    let d = p1;
    return a * t * t * t + b * t * t + c * t + d;
}

fn catmull_rom_Sampling(uv: vec2f, dim: vec2f) -> vec4f {
    
    var p: array<vec4f, 4>;
    for (var i = 0; i < 4; i++) {
        p[i] = textureLoad(demTexture, vec2i(uvCorrection(uv + vec2f(f32(i) - 1.0, 0.0), dim).xy), 0);
    }
    let horizontalColor = cubicInterpolate(p[0], p[1], p[2], p[3], fract(uv.x));

    for (var j = 0; j < 4; j++) {
        p[j] = textureLoad(demTexture, vec2i(uvCorrection(uv + vec2f(0.0, f32(j) - 1.0), dim).xy), 0);
    }
    let verticalColor = cubicInterpolate(p[0], p[1], p[2], p[3], fract(uv.y));

    return mix(horizontalColor, verticalColor, 0.5);
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

fn nan() -> f32 {

    let a = 0.0;
    let b = 0.0;
    return a / b;
}

@vertex
fn vMain(vsInput: VertexInput) -> VertexOutput {


    let dim = vec2f(textureDimensions(demTexture, 0).xy);
    let u = mix(0.0, 1.0, vsInput.uv.x);
    let v = mix(0.0, 1.0, vsInput.uv.y);
    let texcoords = vec2f(u, v) * dim;
    // let ph = textureLoad(demTexture, vec2i(texcoords.xy), 0).rg;
    // let ph = linearSampling(demTexture, texcoords, dim);
    // let ph = catmull_rom_Sampling(texcoords, dim);
    let ph = IDW(demTexture, texcoords, dim, 3, 1);
    let p = mix(staticUniform.p.x, staticUniform.p.y, ph.x);
    let h = mix(staticUniform.h.x, staticUniform.h.y, ph.y);

    let x = vsInput.position.x;
    let y = vsInput.position.y;
    // var z = dynamicUniform.exaggeration * (p - h) / 1000000.0;
    let z = vsInput.elevation;

    var output: VertexOutput;
    output.position = staticUniform.adjust * dynamicUniform.matrix * vec4f(x, y, z, 1.0);
    output.depth = (p - h) / (staticUniform.p.y - staticUniform.h.y);
    output.alpha = linearSampling(borderTexture, texcoords, dim).r;

    return output;
}

@fragment
fn fMain(fsInput: VertexOutput) -> @location(0) vec4f {

    let dim = vec2f(textureDimensions(demTexture, 0).xy);

    var depth = fsInput.depth;
    return vec4f(depth);
    // return vec4f(1.0);
}