struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
    @location(0) position: vec2f,
    @location(1) uv: vec2f,
    @location(2) elevation: f32,
};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(perspective, center) texcoords: vec2f,
    @location(1) @interpolate(perspective, center) ph: vec2f,
};

struct StaticUniformBlock {
    adjust: mat4x4f,
    p: vec2f,
    h: vec2f,
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

@vertex
fn vMain(vsInput: VertexInput) -> VertexOutput {

    let dim = vec2f(textureDimensions(demTexture, 0).xy);
    let u = mix(0.0, 1.0, vsInput.uv.x) + 0.5 / dim.x;
    let v = mix(0.0, 1.0, vsInput.uv.y) + 0.5 / dim.x;
    let texcoords = vec2f(u, v) * dim;
    let ph = textureLoad(demTexture, vec2i(texcoords), 0).rg;

    var output: VertexOutput;
    output.position = staticUniform.adjust * dynamicUniform.matrix * vec4f(vsInput.position, select(0.0, vsInput.elevation, dynamicUniform.zoom > 15.0), 1.0);
    output.texcoords = vec2f(u, v);
    output.ph = ph;

    return output;
}

@fragment
fn fMain(fsInput: VertexOutput) -> @location(0) vec4f {

    var color = select(1.0, 0.0, fsInput.ph.x == 0.0 && fsInput.ph.y == 0.0);

    return vec4f(color);
}