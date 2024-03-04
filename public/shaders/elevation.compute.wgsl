struct StaticUniformBlock {
    p: vec2f,
    h: vec2f,
    groupSize: vec2u,
    vertexNum: u32,
};

struct DynamicUniformBlock {
    exaggeration: f32,
}

// Uniform Bindings
@group(0) @binding(0) var<uniform> staticUniform: StaticUniformBlock;
@group(0) @binding(1) var<uniform> dynamicUniform: DynamicUniformBlock;

// Storage Bindings
@group(1) @binding(0) var<storage> uv: array<f32>;
@group(1) @binding(1) var<storage, read_write> elevation: array<f32>;

// Texture Bindings
@group(2) @binding(0) var demTexture: texture_2d<f32>;

// Constants
override blockSize: u32;

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

@compute @workgroup_size(blockSize, blockSize, 1)
fn cMain(@builtin(global_invocation_id) id: vec3<u32>) {

    let index = id.y * staticUniform.groupSize.x * blockSize + id.x;
    if (index >= staticUniform.vertexNum) {
        return;
    }

    let dim = vec2f(textureDimensions(demTexture, 0).xy);
    let texcoords = vec2f(uv[index * 2 + 0], uv[index * 2 + 1]) * dim;
    
    let ph = IDW(demTexture, texcoords, dim, 3, 1);
    let p = mix(staticUniform.p.x, staticUniform.p.y, ph.x);
    let h = mix(staticUniform.h.x, staticUniform.h.y, ph.y);

    elevation[index] = dynamicUniform.exaggeration * (p - h) / 1000000.0;
    // elevation[index] = 0.0;
}