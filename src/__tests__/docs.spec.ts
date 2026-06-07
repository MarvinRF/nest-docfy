import 'reflect-metadata';
import { docs } from '../docs';

const OPERATION_KEY = 'swagger/apiOperation';
const RESPONSE_KEY = 'swagger/apiResponse';

// Minimal stubs — we test that docs() correctly calls each decorator factory
// with the right (prototype, key, descriptor) arguments, not the full Swagger stack.
function makeApiOperation(meta: object): MethodDecorator {
  return (_target, _key, descriptor) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    Reflect.defineMetadata(OPERATION_KEY, meta, descriptor.value!);
    return descriptor;
  };
}

function makeApiResponse(meta: object): MethodDecorator {
  return (_target, _key, descriptor) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const fn = descriptor.value!;
    const prev: object[] = Reflect.getMetadata(RESPONSE_KEY, fn) ?? [];
    Reflect.defineMetadata(RESPONSE_KEY, [...prev, meta], fn);
    return descriptor;
  };
}

function makeApiTags(...tags: string[]): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata('swagger/apiTags', tags, target);
  };
}

class FakeController {
  findAll() {}
  findOne(_id: string) {}
}

describe('docs()', () => {
  it('applies class decorators to the constructor', () => {
    docs(FakeController, {
      classDecorators: [makeApiTags('fake')],
    });

    expect(Reflect.getMetadata('swagger/apiTags', FakeController)).toEqual(['fake']);
  });

  it('applies method decorators to the correct method', () => {
    docs(FakeController, {
      methods: {
        findAll: [makeApiOperation({ summary: 'Get all' })],
      },
    });

    expect(Reflect.getMetadata(OPERATION_KEY, FakeController.prototype.findAll)).toEqual({
      summary: 'Get all',
    });
  });

  it('accumulates multiple decorators on the same method', () => {
    docs(FakeController, {
      methods: {
        findAll: [
          makeApiResponse({ status: 200, description: 'OK' }),
          makeApiResponse({ status: 404, description: 'Not found' }),
        ],
      },
    });

    const responses: object[] = Reflect.getMetadata(RESPONSE_KEY, FakeController.prototype.findAll);
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ status: 200 });
    expect(responses[1]).toMatchObject({ status: 404 });
  });

  it('applies decorators to multiple methods in one call', () => {
    docs(FakeController, {
      methods: {
        findAll: [makeApiOperation({ summary: 'List' })],
        findOne: [makeApiOperation({ summary: 'Get one' })],
      },
    });

    expect(Reflect.getMetadata(OPERATION_KEY, FakeController.prototype.findAll)).toMatchObject({
      summary: 'List',
    });
    expect(Reflect.getMetadata(OPERATION_KEY, FakeController.prototype.findOne)).toMatchObject({
      summary: 'Get one',
    });
  });

  it('warns and skips when method name does not exist', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    docs(FakeController, {
      methods: {
        nonExistentMethod: [makeApiOperation({ summary: 'Oops' })],
      },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"nonExistentMethod"'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('FakeController'),
    );

    warnSpy.mockRestore();
  });

  it('does nothing when methods map is omitted', () => {
    expect(() => docs(FakeController, {})).not.toThrow();
    expect(() => docs(FakeController, { classDecorators: [] })).not.toThrow();
  });
});
