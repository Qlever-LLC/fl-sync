module.exports = {
  "bookmarks": {
    "_type": "application/vnd.oada.bookmarks.1+json",
    "_rev": 0,
    "trellisfw": {
      "_type": "application/vnd.trellis.1+json",
      "_rev": 0,
      "trading-partners": {
        "_type": "application/vnd.trellisfw.trading-partners.1+json",
        "_rev": 0,
        "*": {
          "_type": "application/vnd.trellisfw.trading-partner.1+json",
          "_rev": 0,
          'shared': {
            '_type': 'application/vnd.oada.bookmarks.1+json',
            '_rev': 0,
            'trellisfw': {
              '_type': 'application/vnd.oada.trellisfw.1+json',
              '_rev': 0,
              'documents': {
                '_type': 'application/vnd.oada.trellisfw.documents.1+json',
                '*': {
                  '_type': 'application/vnd.oada.trellisfw.document.1+json',
                }
              },
              'fsqa-audits': {
                '_type': 'application/vnd.oada.trellisfw.fsqa-audits.1+json',
                '*': {
                  '_type': 'application/vnd.oada.trellisfw.document.1+json',
                }
              }
            }
          }
        },
        "unidentified-trading-partners": {
          "_type": "application/vnd.trellisfw.trading-partners.1+json",
          "_rev": 0,
          "*": {
            "_type": "application/vnd.trellisfw.trading-partner.1+json",
            "_rev": 0
          }
        }
      }
    }
  }
}