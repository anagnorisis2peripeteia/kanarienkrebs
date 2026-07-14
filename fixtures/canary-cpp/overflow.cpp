// validate-provider canary for kanarienkrebs' cpp-sanitizer lane.
//
// Plants two REAL latent memory/UB hazards that a normal build silently runs
// past but the sanitizer layer (-fsanitize=address,undefined) turns into hard,
// nonzero failures:
//
//   (1) a signed-integer overflow  -> UndefinedBehaviorSanitizer
//   (2) a heap-buffer-overflow read -> AddressSanitizer
//
// Both indices/operands are derived from argc so the compiler cannot prove the
// hazard at compile time and fold/optimise it away; a bare run has argc == 1.
//
//   Plain  `clang++ overflow.cpp && ./a.out`                       -> exits 0.
//   With   `-fsanitize=address,undefined`                          -> UBSan prints
//     "runtime error: signed integer overflow" (recovers, continues), then ASan
//     reports "heap-buffer-overflow" and ABORTS the process (nonzero / SIGABRT).
//
// The lane is proven live only if the sanitizer build flips 0 -> nonzero AND a
// sanitizer report appears. UBSan recovers by default so BOTH sanitizers surface
// in one run; ASan's abort provides the deterministic nonzero flip.
#include <cstdio>

int main(int argc, char** argv) {
  (void)argv;
  // (1) UBSan: signed integer overflow (INT_MAX + argc).
  int big = 2147483647;          // INT_MAX
  volatile int ub = big + argc;  // overflow for argc >= 1
  (void)ub;

  // (2) ASan: heap-buffer-overflow — read one past the end of a heap array.
  const int n = 8;
  int* a = new int[n];
  for (int i = 0; i < n; ++i) a[i] = i;
  int idx = n + argc - 1;        // == n (one past the end) when argc == 1
  volatile int sink = a[idx];    // out-of-bounds READ -> ASan aborts
  printf("canary survived: a[%d]=%d ub=%d (if you see this WITH sanitizers, they did NOT fire)\n",
         idx, (int)sink, (int)ub);
  delete[] a;
  return 0;
}
