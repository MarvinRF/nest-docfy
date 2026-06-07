import 'reflect-metadata';
import { WithDocs, DOCFY_MARKER } from '../with-docs.decorator';
import { DocfyRegistry } from '../registry';

describe('@WithDocs()', () => {
  beforeEach(() => {
    DocfyRegistry._reset();
  });

  it('sets DOCFY_MARKER metadata on the class', () => {
    @WithDocs()
    class TestController {}

    expect(Reflect.getMetadata(DOCFY_MARKER, TestController)).toBe(true);
  });

  it('registers the class in DocfyRegistry', () => {
    @WithDocs()
    class AnotherController {}

    expect(DocfyRegistry.getAll().has(AnotherController)).toBe(true);
  });

  it('registers multiple classes independently', () => {
    @WithDocs()
    class ControllerA {}

    @WithDocs()
    class ControllerB {}

    const registry = DocfyRegistry.getAll();
    expect(registry.has(ControllerA)).toBe(true);
    expect(registry.has(ControllerB)).toBe(true);
  });

  it('does not register the same class twice', () => {
    @WithDocs()
    class UniqueController {}

    // Applying the decorator a second time (unusual but possible programmatically)
    WithDocs()(UniqueController);

    expect(DocfyRegistry.getAll().size).toBe(1);
  });
});
