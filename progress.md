# Catchup

## Transpilation Status
* MBB App: 100%
* Opus UI website: 100%

## Next Steps
* Infinite recursion bug in morphProps when running transpiled Legoz

# Todo
* Only copy over json files (traits, blueprints) that are actually used (see limitations.1)
* Only import getDeepProperty if actually used
* Treat blueprint and blueprintPrps as trait and traitPrps
* Allow identifying files as traits even without acceptPrps
* Allow generation of acceptPrps based on %key% occurences

# Limitations
1. extraWgts are still rendered as JSON
