import type {Tree} from '@oada/list-lib'
export const tree : Tree = {
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
            'assessments': {
              '_type': 'application/vnd.oada.trellisfw.1+json',
              '_rev': 0,
              '*': {
                '_type': 'application/vnd.oada.trellisfw.1+json',
                '_rev': 0,
              }
            },
            'documents': {
              '_type': 'application/vnd.oada.trellisfw.1+json',
              '_rev': 0,
              '*': {
                '_type': 'application/vnd.oada.trellisfw.1+json',
                '_rev': 0,
              }
            },
            'locations': {
              '_type': 'application/vnd.oada.trellisfw.1+json',
              '_rev': 0,
              '*': {
                '_type': 'application/vnd.oada.trellisfw.1+json',
                '_rev': 0,
              }
            },
            'products': {
              '_type': 'application/vnd.oada.trellisfw.1+json',
              '_rev': 0,
              '*': {
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

export default tree;
