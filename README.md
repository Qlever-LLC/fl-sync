## Installation

```cd path/to/your/oada-srvc-docker
cd services-available
git clone git@github.com:trellisfw/fl-sync.git
cd ../services-enabled
ln -s ../services-available/fl-sync .
oada up -d fl-sync```
