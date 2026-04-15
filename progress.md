# Catchup

## Transpilation Status
* MBB App: 100%
* Opus UI website: 100%

## Next Steps
* Infinite recursion bug in morphProps when running transpiled Legoz

# Todo
* Only copy over json files (traits, blueprints) that are actually used (see limitations.1)
* Only import getDeepProperty if actually used
* Allow generation of acceptPrps based on %key% occurences

# Limitations
1. extraWgts are still rendered as JSON

# Broken in bridge
* MDM / Saving on the 'edit detail modal' on quotes
* MDM / Debtors crashes
* MDM / View Division doesn't show data in the form
* MDM / GL Account View details doesn't show data in the form
* MDM / Hauler management crashes
* MDM / Saving on invoice template type crashes
* MDM / SBO Group Code crashes
* MDM / Suppliers crashes
* Workflow / All 9 Dashboards / Duplicate id errors
* Forwarding / Journals / Crash
* Forwarding / Projects / Crash
* Forwarding / Services / Crash
* Terminals / InSights Mobile Reports / Crash
* Terminals / Project Schedule / Crash
* Terminals / Warehouse Schedule / Crash
* Terminals / Transit Schedule / Crash
= 24 / 65 Total

# Crashes on bridge