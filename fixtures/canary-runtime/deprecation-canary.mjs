// validate-provider canary for the kanarienkrebs ts-runtime lane.
// Plain `node canary.mjs`               -> emits a warning, exits 0.
// `node --throw-deprecation canary.mjs` -> the warning THROWS, exits nonzero.
// The lane is proven live only if the strict layer flips 0 -> nonzero.
process.emitWarning("kanarienkrebs canary — this deprecation MUST throw under the layer", {
  type: "DeprecationWarning",
});
console.log("canary survived: if you see this WITH the layer, the layer is NOT active");
