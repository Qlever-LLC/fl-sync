module.exports = {
  'bookmarks': {
    '_type': 'application/vnd.oada.bookmarks.1+json',
    '_rev': 0,
    'services': {
      '_type': 'application/vnd.oada.services.1+json',
      '_rev': 0,
      'fl-sync': {
        '_type': 'application/vnd.oada.service.1+json',
        '_rev': 0,
        'businesses': {
          '_type': 'application/vnd.oada.trellisfw.1+json',
          '_rev': 0,
          '*': {
            '_type': 'application/vnd.oada.trellisfw.1+json',
            '_rev': 0,
            'documents': {
              //              '_type': 'application/vnd.foodlogiq.documents.1+json',
              '_type': 'application/vnd.oada.trellisfw.1+json',
              '_rev': 0,
              '*': {
                //                '_type': 'application/vnd.foodlogiq.document.1+json',
                '_type': 'application/vnd.oada.trellisfw.1+json',
                '_rev': 0,
              }
            },
            'locations': {
              //'_type': 'application/vnd.foodlogiq.locations.1+json',
              '_type': 'application/vnd.oada.trellisfw.1+json',
              '_rev': 0,
              '*': {
                //'_type': 'application/vnd.foodlogiq.location.1+json',
                '_type': 'application/vnd.oada.trellisfw.1+json',
                '_rev': 0,
              }
            },
            'products': {
              //'_type': 'application/vnd.foodlogiq.products.1+json',
              '_type': 'application/vnd.oada.trellisfw.1+json',
              '_rev': 0,
              '*': {
                //'_type': 'application/vnd.foodlogiq.product.1+json',
                '_type': 'application/vnd.oada.trellisfw.1+json',
                '_rev': 0,
              }
            }
          }
        }
      }
    }
  }
}