// validate-provider canary for kanarienkrebs' dotnet-runtime lane.
//
// Plants a REAL latent globalization hazard: the program constructs and uses a
// specific named culture (fr-FR) — the kind of thing production code does all the
// time for formatting/parsing. Under the default ICU runtime this silently works.
// Under the strict layer (DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1, which switches
// the process to invariant globalization + PredefinedCulturesOnly), constructing a
// non-invariant culture throws CultureNotFoundException. There is deliberately NO
// try/catch, so that exception goes unhandled and the process exits NONZERO — this
// is exactly the failure such code hits when deployed to an invariant-globalization
// environment (minimal containers, Native AOT, trimmed apps).
//
// Plain `dotnet canary.dll`                                    -> exits 0.
// With DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 (strict layer)  -> exits nonzero.
// The lane is proven live only if the strict layer flips 0 -> nonzero.
//
// NOTE: InvariantGlobalization is intentionally NOT set in canary.csproj — the lane
// toggles it purely via the environment. Baking it in would make BOTH runs throw
// and destroy the flip.
using System;
using System.Globalization;

internal static class Program
{
    private static int Main()
    {
        var culture = new CultureInfo("fr-FR");
        var formatted = (1234.5).ToString("N1", culture);
        Console.WriteLine(
            "canary survived: fr-FR formatted 1234.5 as '" + formatted +
            "' - if you see this WITH the layer, the layer is NOT active");
        return 0;
    }
}
