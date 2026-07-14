// validate-provider canary kernel for kanarienkrebs' metal-validation lane.
//
// `out` is bound (by harness.mm) to a device buffer of exactly `n` uints, but the
// harness dispatches MANY more than `n` threads, so every thread with gid >= n
// writes past the end of the buffer. Under Metal Shader Validation
// (MTL_SHADER_VALIDATION=1) that out-of-bounds device store is reported to stderr
// ("Invalid device store at offset ... length:16"); without validation the write
// silently corrupts/drops and the run completes clean. The lane is proven live
// only if the validation layer surfaces the OOB that a plain run does not.
#include <metal_stdlib>
using namespace metal;

kernel void oob_write(device uint*   out [[buffer(0)]],
                      constant uint& n   [[buffer(1)]],
                      uint           gid [[thread_position_in_grid]]) {
    out[gid] = gid;   // out-of-bounds device store for gid >= n
}
