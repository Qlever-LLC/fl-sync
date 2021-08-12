
async function main() {
  let con = await oada.connect({
    domain: 'https://'+DOMAIN,
    token: 'Bearer '+TOKEN[0]
  })

  await reset()
}

async function reset() {
  //1. delete trading partners
  con.delete({
    path: `/bookmarks/trellisfw/trading-partners`
  })
  //2. delete businesses
  con.delete({
    path: `/bookmarks/services/fl-sync/businesses`
  })
  //3. delete target job list lib entry
  con.delete({
    path: `/bookmarks/services/target/jobs/_meta/oada-list-lib/target-jobs-fl-sync`
  })
}
