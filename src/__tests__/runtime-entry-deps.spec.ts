// The runtime entry must not load the build-time scanner: ts-morph drags in its whole glob
// stack (tinyglobby/picomatch), which a running app never uses.
jest.mock('ts-morph', () => {
  throw new Error('ts-morph was loaded by the runtime entry');
});

describe('runtime entry', () => {
  it('does not load ts-morph', () => {
    expect(() => jest.requireActual('../index')).not.toThrow();
  });
});
