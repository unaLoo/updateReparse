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
@group(2) @binding(0) var<storage, read_write> particleVelocity: array<f32>;
@group(2) @binding(1) var<storage, read_write> indexArray: array<u32>;
@group(2) @binding(2) var<storage, read_write> aliveNum: array<atomic<u32>, 4>;
@group(2) @binding(3) var<storage, read_write> particleAge: array<f32>;
@group(2) @binding(4) var<storage, read_write> particleAttribute: array<f32>;

// Constants
override blockSize: u32;

// pseudo-random generator
fn rand(co: vec2f) -> f32 {
    let rand_constants = vec3f(12.9898, 78.233, 4375.85453);
    let t = dot(rand_constants.xy, co);
    return abs(fract(sin(t) * (rand_constants.z + t)));
}

fn drop(velocity: f32, uv: vec2f) -> f32 {
    let seed = uv * frameUniform.randomSeed;
    let drop_rate = controllerUniform.dropRate + velocity * controllerUniform.dropRateBump;
    return step(drop_rate, rand(seed));
}

fn is_in_flow_progress(position: vec2f) -> f32 {

    let textureSize = textureDimensions(seedingTexture, 0);
    let uv = vec2u(position * vec2f(textureSize));
    let color1 = textureLoad(seedingTexture, uv, 0);
    // let color1 = textureLoad(seedingTexture, uv, 0);

    let xy1 = vec2u((u32(color1.x * 255.0) << 8) + u32(color1.y * 255.0), (u32(color1.z * 255.0) << 8) + u32(color1.w * 255.0));
    return select(0.0, 1.0, (xy1.x == uv.x) && (xy1.y == uv.y));
}

fn get_speed(uv: vec2f, fTexture: texture_2d<f32>) -> vec2f {

    var f = fract(uv);
    var parity = vec2i(select(-1, 1, f.x >= 0.5), select(-1, 1, f.y >= 0.5));
    let uv0 = vec2i(uv);
    let uv1 = uv0 + vec2i(parity.x, 0);
    let uv2 = uv0 + vec2i(0, parity.y);
    let uv3 = uv0 + vec2i(parity.x, parity.y);

    let speed0 = textureLoad(fTexture, uv0, 0).xy;
    let speed1 = textureLoad(fTexture, uv1, 0).xy;
    let speed2 = textureLoad(fTexture, uv2, 0).xy;
    let speed3 = textureLoad(fTexture, uv3, 0).xy;

    let lerp = abs(f - vec2f(0.5));
    let speed =  mix(mix(speed0.xy, speed1.xy, lerp.x), mix(speed2, speed3, lerp.x), lerp.y);
    return speed;
}

fn lookup_speed(position: vec2f) -> vec2f {
    
    let textureSize = textureDimensions(seedingTexture, 0);
    let uv = position * vec2f(textureSize);

    let speed1 = mix(staticUniform.flowBoundary.xy, staticUniform.flowBoundary.zw, get_speed(uv, fTexture1));
    let speed2 = mix(staticUniform.flowBoundary.xy, staticUniform.flowBoundary.zw, get_speed(uv, fTexture2));

    return mix(speed1, speed2, frameUniform.progress);
}

fn speed_rate(velocity: vec2f) -> f32 {
    
    return length(velocity) / length(staticUniform.flowBoundary.zw);
    // return length(velocity - staticUniform.flowBoundary.xy) / length(staticUniform.flowBoundary.zw - staticUniform.flowBoundary.xy);
}

fn isInField(position: vec2f) -> bool {
    
    let textureSize = textureDimensions(seedingTexture, 0);
    let uv = vec2u(position * vec2f(textureSize));
    let color1 = textureLoad(seedingTexture, uv, 0);
    // let color1 = textureLoad(seedingTexture, uv, 0);

    let xy1 = vec2u((u32(color1.x * 255.0) << 8) + u32(color1.y * 255.0), (u32(color1.z * 255.0) << 8) + u32(color1.w * 255.0));
    return (xy1.x == uv.x) && (xy1.y == uv.y);
}

fn die(particleIndex: u32, nextIndex: u32, nextOffset: u32, particleInfo: vec4f) {

    let seed = frameUniform.randomSeed + particleInfo.xy;
    let texcoords = vec2f(rand(seed + 1.4), rand(seed + 2.1));

    let textureSize = vec2f(textureDimensions(seedingTexture, 0));
    let uv = vec2u(texcoords * textureSize);
    
    let rebirthColor = textureLoad(seedingTexture, uv, 0);
    var rebirth_x = f32((u32(rebirthColor.x * 255.0) << 8) + u32(rebirthColor.y * 255.0));
    var rebirth_y = f32((u32(rebirthColor.z * 255.0) << 8) + u32(rebirthColor.w * 255.0));
    rebirth_x = rebirth_x + rand(seed + rebirth_x);
    rebirth_y = rebirth_y + rand(seed + rebirth_y);
    let rebirthPos = vec2f(rebirth_x, rebirth_y) / textureSize;
    
    particleVelocity[2 * nextIndex] = rebirthPos.x;
    particleVelocity[2 * nextIndex + 1] = rebirthPos.y;
    particleAge[nextIndex - nextOffset] = particleInfo.z + 1.0;
    particleAttribute[nextIndex] = speed_rate(lookup_speed(rebirthPos));
}

fn simulation(particleIndex: u32, nextIndex: u32, nextOffset: u32, particleInfo: vec4f) {

    let textureSize = vec2f(textureDimensions(seedingTexture, 0));
    let velocity = lookup_speed(particleInfo.xy);
    let speedRate = speed_rate(velocity);

    var newPos = particleInfo.xy + velocity * controllerUniform.speedFactor / textureSize;
    newPos = clamp(newPos, vec2f(0.0), vec2f(1.0));
    
    let dropped = drop(speedRate, particleInfo.xy) * is_in_flow_progress(newPos);
    // let dropped = drop(speedRate, particleInfo.xy);

    let dyingInfo = vec4f(particleInfo.xy, staticUniform.fullLife - staticUniform.maxSegmentNum, particleInfo.w);
    let newInfo = vec4f(newPos, particleInfo.z + 1.0, speedRate);
    let realInfo = mix(dyingInfo, newInfo, dropped);

    particleVelocity[2 * nextIndex] = realInfo.x;
    particleVelocity[2 * nextIndex + 1] = realInfo.y;
    particleAge[nextIndex - nextOffset] = realInfo.z;
    particleAttribute[nextIndex] = realInfo.w;
}

fn freeze(particleIndex: u32, nextIndex: u32, nextOffset: u32, particleInfo: vec4f) {

    particleVelocity[2 * nextIndex] = particleInfo.x;
    particleVelocity[2 * nextIndex + 1] = particleInfo.y;
    particleAge[nextIndex - nextOffset] = particleInfo.z + 1.0;
    particleAttribute[nextIndex] = particleInfo.w;
}

fn rebirth(particleIndex: u32, nextIndex: u32, nextOffset: u32, particleInfo: vec4f) {

    particleVelocity[2 * nextIndex] = particleInfo.x;
    particleVelocity[2 * nextIndex + 1] = particleInfo.y;
    particleAge[nextIndex - nextOffset] = 0.0;
    particleAttribute[nextIndex] = particleInfo.w;
}

@compute @workgroup_size(blockSize, blockSize, 1)
fn cMain(@builtin(global_invocation_id) id: vec3<u32>) {

    let indexOffset = u32(frameUniform.startReadIndex * staticUniform.maxParticleNum);
    let nextIndexOffset = u32(frameUniform.startStorageIndex * staticUniform.maxParticleNum);
    let particleIndex = indexOffset + id.y * staticUniform.groupSize.x * blockSize + id.x;
    let nextIndex = nextIndexOffset + id.y * staticUniform.groupSize.x * blockSize + id.x;
    // let nextIndex = particleIndex;

    // let particleIndex = id.y * staticUniform.groupSize.x * blockSize + id.x;
    let currentPos = vec2f(particleVelocity[2 * particleIndex], particleVelocity[2 * particleIndex + 1]);
    let currentAge = particleAge[particleIndex - indexOffset];
    let currentAttribute = particleAttribute[particleIndex];
    let particleInfo = vec4f(currentPos, currentAge, currentAttribute);

    if (currentAge <= staticUniform.fullLife - staticUniform.maxSegmentNum) {
        simulation(particleIndex, nextIndex, nextIndexOffset, particleInfo);
    }
    else if (currentAge == staticUniform.fullLife) {
        die(particleIndex, nextIndex, nextIndexOffset, particleInfo);
    }
    else if (abs(staticUniform.fullLife - currentAge) < staticUniform.maxSegmentNum) {
        freeze(particleIndex, nextIndex, nextIndexOffset, particleInfo);
    }
    else {
        rebirth(particleIndex, nextIndex, nextIndexOffset, particleInfo);
    }


    if ((id.y * staticUniform.groupSize.x * blockSize + id.x < controllerUniform.particleNum) && particleAge[nextIndex - nextIndexOffset] < staticUniform.fullLife) {
        indexArray[atomicAdd(&aliveNum[1], 1)] = particleIndex - indexOffset;
    }
}