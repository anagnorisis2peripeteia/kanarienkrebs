// validate-provider harness for kanarienkrebs' metal-validation lane.
//
// A minimal ObjC++ Metal compute host: it loads kernel.metal (path in argv[1],
// else a sibling file), compiles it at runtime, and dispatches many more threads
// than the output buffer can hold so the kernel writes out of bounds (see
// kernel.metal). It then waits and, defensively, exits nonzero if the command
// buffer surfaced an error.
//
// On this Mac (macOS 26, Apple GPU) Metal Shader Validation reports the OOB to
// STDERR ("Invalid device store ... length:16") but does NOT set commandBuffer.error
// or abort, so the process still exits 0 — the lane keys the flip on the validation
// DIAGNOSTIC (present only under MTL_SHADER_VALIDATION=1), not the exit code. The
// commandBuffer.error check is kept so that a future OS which promotes the fault to
// a command-buffer error / abort still flips via a nonzero exit.
//
//   Plain run                                -> "canary survived", exit 0, no diag.
//   MTL_SHADER_VALIDATION=1 MTL_DEBUG_LAYER=1 -> "Invalid device store ..." on stderr.
//
// Build: xcrun clang++ -std=c++17 -fobjc-arc -framework Metal -framework Foundation
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

int main(int argc, const char** argv) {
  @autoreleasepool {
    std::string metalPath = (argc > 1) ? argv[1] : "kernel.metal";
    std::ifstream f(metalPath);
    if (!f) { fprintf(stderr, "canary: cannot open %s\n", metalPath.c_str()); return 70; }
    std::stringstream ss; ss << f.rdbuf();
    std::string src = ss.str();

    id<MTLDevice> dev = MTLCreateSystemDefaultDevice();
    if (!dev) { fprintf(stderr, "canary: no Metal device\n"); return 70; }

    NSError* err = nil;
    id<MTLLibrary> lib = [dev newLibraryWithSource:[NSString stringWithUTF8String:src.c_str()]
                                           options:nil
                                             error:&err];
    if (!lib) { fprintf(stderr, "canary: compile failed: %s\n", err ? err.localizedDescription.UTF8String : "?"); return 71; }
    id<MTLFunction> fn = [lib newFunctionWithName:@"oob_write"];
    if (!fn) { fprintf(stderr, "canary: no function\n"); return 72; }
    id<MTLComputePipelineState> pso = [dev newComputePipelineStateWithFunction:fn error:&err];
    if (!pso) { fprintf(stderr, "canary: pso failed: %s\n", err ? err.localizedDescription.UTF8String : "?"); return 73; }

    const uint32_t n = 4;         // output buffer holds 4 uints (16 bytes)
    const uint32_t threads = 256; // dispatch far more => OOB stores for gid >= n
    id<MTLBuffer> buf  = [dev newBufferWithLength:n * sizeof(uint32_t) options:MTLResourceStorageModeShared];
    id<MTLBuffer> nbuf = [dev newBufferWithBytes:&n length:sizeof(uint32_t) options:MTLResourceStorageModeShared];

    id<MTLCommandQueue> q = [dev newCommandQueue];
    id<MTLCommandBuffer> cb = [q commandBuffer];
    id<MTLComputeCommandEncoder> enc = [cb computeCommandEncoder];
    [enc setComputePipelineState:pso];
    [enc setBuffer:buf offset:0 atIndex:0];
    [enc setBuffer:nbuf offset:0 atIndex:1];
    [enc dispatchThreads:MTLSizeMake(threads, 1, 1) threadsPerThreadgroup:MTLSizeMake(64, 1, 1)];
    [enc endEncoding];
    [cb commit];
    [cb waitUntilCompleted];

    if (cb.error) {
      fprintf(stderr, "canary: command buffer error: %s\n", cb.error.localizedDescription.UTF8String);
      return 1;  // flip via nonzero if the OS promotes the fault to an error
    }
    fprintf(stdout, "canary survived: no command-buffer error (if you see this WITH validation, it did NOT catch the OOB)\n");
    return 0;
  }
}
