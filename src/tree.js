let docsTree = {
  '_type': 'application/vnd.oada.bookmarks.1+json',
  '_rev': 0,
  'trellisfw': {
    '_type': 'application/vnd.oada.trellisfw.1+json',
    '_rev': 0,
    'documents': {
      '_type': 'application/vnd.oada.trellisfw.documents.1+json',
      '*': { //cois, letters-of-guarantee, fsqa-audits, etc.
        '_type': 'application/vnd.oada.trellisfw.documents.1+json',
        '*': { // individual docs here
          '_type': 'application/vnd.oada.trellisfw.document.1+json',
        }
      }
    }
  }
}

module.exports = {
  'bookmarks': {
    '_type': 'application/vnd.oada.bookmarks.1+json',
    '_rev': 0,
    'trellisfw': {
      '_type': 'application/vnd.oada.trellisfw.1+json',
      '_rev': 0,
      'trading-partners': {
        '_type': 'application/vnd.oada.trading-partners.1+json',
        '_rev': 0,
        'masterid-index': {
          '_type': 'application/vnd.oada.trading-partners.1+json',
          '_rev': 0,
          '*': {
            '_type': 'application/vnd.oada.trading-partner.1+json',
            '_rev': 0,
            'shared': docsTree,
            'bookmarks': docsTree,
          },
        },
      },
      'documents': {
        '_type': 'application/vnd.oada.trellisfw.1+json',
        '_rev': 0,
      }
    },
    'services': {
      '_type': 'application/vnd.oada.services.1+json',
      '_rev': 0,
      'fl-sync': {
        '_type': 'application/vnd.oada.service.1+json',
        '_rev': 0,
        'monitors': {
          '_type': 'application/vnd.oada.service.1+json',
          '*': {
            '_type': 'application/vnd.oada.service.1+json',
            '*': {}
          }
        },
        'jobs': {
          '_type': 'application/vnd.oada.service.jobs.1+json',
          '*': {
            '_type': 'application/vnd.oada.service.job.1+json',
            '_rev': 0,
          }
        },
        'assessment-templates': {
          '_type': 'application/vnd.oada.trellisfw.1+json',
          '_rev': 0,
          '*': {
            '_type': 'application/vnd.oada.trellisfw.1+json',
            '_rev': 0,
          }
        },
        'process-queue': {
          '_type': 'application/vnd.oada.trellisfw.1+json',
          '_rev': 0,
        },
        'businesses': {
          '_type': 'application/vnd.oada.trellisfw.1+json',
          '_rev': 0,
          '*': {
            '_type': 'application/vnd.oada.trellisfw.1+json',
            '_rev': 0,
            'assessments': {
//              '_type': 'application/vnd.foodlogiq.documents.1+json',
              '_type': 'application/vnd.oada.trellisfw.1+json',
              '_rev': 0,
              '*': {
//                '_type': 'application/vnd.foodlogiq.document.1+json',
                '_type': 'application/vnd.oada.trellisfw.1+json',
                '_rev': 0,
              }
            },
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


