struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
    @location(0) position: vec4f,
};

struct VertexOutput {
    @builtin(position) position: vec4f,
};

struct CenterUniformBlock {
    hlZ: vec2f,
    boundsH: vec4f,
    boundsL: vec4f,
    eT: vec2f,
    eB: vec2f,
}

struct StaticUniformBlock {
    adjust: mat4x4f,
    terrainBox: vec4f,
    e: vec2f,
};

struct DynamicUniformBlock {
    matrix: mat4x4f,
    oMatrix: mat4x4f,
    exaggeration: f32,
    zoom: f32,
    centerLow: vec2f,
    centerHigh: vec2f,
    z: vec2f,
};

// Uniform Bindings
@group(0) @binding(0) var<uniform> centerUniform: CenterUniformBlock;
@group(0) @binding(1) var<uniform> staticUniform: StaticUniformBlock;
@group(0) @binding(2) var<uniform> dynamicUniform: DynamicUniformBlock;

// Texture Bindings
@group(1) @binding(0) var demTexture: texture_2d<f32>;

const PI = 3.141592653;

fn altitude2Mercator(lat: f32, alt: f32) -> f32 {
    let earthRadius = 6371008.8;
    let earthCircumference = 2.0 * PI * earthRadius;
    return alt / earthCircumference * cos(lat * PI / 180.0);
}

fn latFromMercatorY(y: f32) -> f32 {
    let y2 = 180.0 - y * 360.0;
    return 360.0 / PI * atan(exp(y2 * PI / 180.0)) - 90.0;
}

fn calcWebMercatorCoord(coord: vec2f) -> vec2f {

    let lon = (180.0 + coord.x) / 360.0;
    let lat = (180.0 - (180.0 / PI * log(tan(PI / 4.0 + coord.y * PI / 360.0)))) / 360.0;
    return vec2f(lon, lat);
}

fn uvCorrection(uv: vec2f, dim: vec2f) -> vec2f {

    return clamp(uv, vec2f(0.0), dim - vec2f(1.0));
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

fn translateRelativeToEye(high: vec3f, low: vec3f) -> vec3f {

    let highDiff = high - vec3f(dynamicUniform.centerHigh, dynamicUniform.z[0]);
    let lowDiff = low - vec3f(dynamicUniform.centerLow, dynamicUniform.z[1]);

    return highDiff + lowDiff;
}

@vertex
fn vMain(vsInput: VertexInput) -> VertexOutput {

    let hPosition = vsInput.position.xy * (centerUniform.boundsH.zw - centerUniform.boundsH.xy) + centerUniform.boundsH.xy;
    let lPosition = vsInput.position.zw * (centerUniform.boundsL.zw - centerUniform.boundsL.xy) + centerUniform.boundsL.xy;
    let dim = vec2f(textureDimensions(demTexture, 0).xy);

    let mMin = calcWebMercatorCoord(staticUniform.terrainBox.xy);
    let mMax = calcWebMercatorCoord(staticUniform.terrainBox.zw);
    var color = vec3f(0.0);
    var z = 0.0;
    var highE = 0.0;
    var lowE = 0.0;
    var highZ = 0.0;
    var lowZ = 0.0;

    if ((hPosition.x >= mMin.x && hPosition.x <= mMax.x) && (hPosition.y >= mMax.y && hPosition.y <= mMin.y)) {

        let u = (hPosition.x - mMin.x) / (mMax.x - mMin.x);
        let v = (hPosition.y - mMin.y) / (mMax.y - mMin.y);
        let uv = vec2f(u, v);
        // let elevation = mix(staticUniform.e.x, staticUniform.e.y, IDW(demTexture, vec2f(0.32, 0.0) * dim, dim, 3, 1).r);
        let elevation = mix(staticUniform.e.x, staticUniform.e.y, linearSampling(demTexture, uv * dim, dim).r);
        highE = mix(centerUniform.eB[0], centerUniform.eT[0], 0.0);
        lowE = mix(centerUniform.eB[1], centerUniform.eT[1], 0.0);
        highZ = dynamicUniform.exaggeration * altitude2Mercator(latFromMercatorY(hPosition.y), elevation) * 10.0;
        lowZ = dynamicUniform.exaggeration * altitude2Mercator(latFromMercatorY(lPosition.y), elevation) * 10.0;
        highZ = select(highZ, 0.000000002, highZ > 0.0);
        lowZ = select(lowZ, 0.000000002, lowZ > 0.0);
        z = select(z, 0.000000002, z > 0.0);
    } else {
        
        z = 0.0;
    }

    let correctPos = translateRelativeToEye(vec3f(hPosition, 0.000000002), vec3f(lPosition, 0.000000002));
    let pos_CS = dynamicUniform.oMatrix * vec4f(correctPos, 1.0);
    var output: VertexOutput;
    output.position = pos_CS;

    return output;
}

@fragment
fn fMain(fsInput: VertexOutput) -> @location(0) vec4f {

    return vec4f(vec3f(0.8, 0.3, 0.2), 1.0);
}