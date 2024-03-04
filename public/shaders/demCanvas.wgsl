struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
};

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) @interpolate(perspective, center) texcoords: vec2f,
};

// Texture Bindings
@group(0) @binding(0) var lsampler: sampler;
@group(0) @binding(1) var sceneTexture: texture_2d<f32>;
@group(0) @binding(2) var maskTexture: texture_2d<f32>;
@group(0) @binding(3) var lodMap: texture_2d<f32>;

@vertex
fn vMain(vsInput: VertexInput) -> VertexOutput {

    let vertices = array<vec2f, 4> (
        vec2f(-1.0, -1.0),
        vec2f(-1.0, 1.0),
        vec2f(1.0, -1.0),
        vec2f(1.0, 1.0)
    );

    let uvs = array<vec2f, 4> (
        vec2f(0.0, 0.0),
        vec2f(0.0, 1.0),
        vec2f(1.0, 0.0),
        vec2f(1.0, 1.0)
    );
    var output: VertexOutput;
    output.position = vec4f(vertices[vsInput.vertexIndex], 0.0, 1.0);
    output.texcoords = vec2f(uvs[vsInput.vertexIndex].x, 1.0 - uvs[vsInput.vertexIndex].y);

    return output;
}

@fragment
fn fMain(fsInput: VertexOutput) -> @location(0) vec4f {

    let color = textureSample(sceneTexture, lsampler, fsInput.texcoords);
    let mask = textureSample(maskTexture, lsampler, fsInput.texcoords);
    let dim = vec2f(textureDimensions(lodMap, 0));
    let lod = textureLoad(lodMap, vec2i(fsInput.texcoords * dim.xy), 0);

    // if (mask.r == 0.0) {
    //     // return vec4f(1.0);
    //     discard;
    // }

    return vec4f(0.5, 0.5, 0.5, color.r);
    // return vec4f(color.r, color.r, color.r, 1.0);
    // return vec4f(color.rgb, 0.5);
    // return color;
    // return vec4f(lod.rgb, 0.5);
    // return mask;
    // return vec4f(alpha, alpha, alpha, 0.5);
}