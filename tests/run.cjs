const harness = require("./harness.cjs");
for (const group of ["addon-service","config","core-runtime-performance","core-size-dialog-shell","core-size-reduction","core","integration"]) require(`./groups/${group}.cjs`)(harness);
void harness.finish();
