# validate-provider canary for kanarienkrebs' python-dev lane.
# Plain `python3 deprecation_canary.py`                 -> warns, exits 0.
# With PYTHONWARNINGS=error::DeprecationWarning (dev layer) -> the warning is
# raised as an exception, exits nonzero.
# The lane is proven live only if the dev layer flips 0 -> nonzero.
import warnings

warnings.warn(
    "kanarienkrebs canary — this deprecation MUST become an error under the dev layer",
    DeprecationWarning,
)
print("canary survived: if you see this WITH the layer, the layer is NOT active")
