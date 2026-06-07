import 'reflect-metadata';
import { docs } from '../docs';

const OPERATION_KEY = 'swagger/apiOperation';
const RESPONSE_KEY = 'swagger/apiResponse';
const TAGS_KEY = 'swagger/apiTags';

function makeApiOperation(meta: object): MethodDecorator {
  return (_target, _key, descriptor) => {
    Reflect.defineMetadata(OPERATION_KEY, meta, descriptor.value!);
    return descriptor;
  };
}

function makeApiResponse(meta: object): MethodDecorator {
  return (_target, _key, descriptor) => {
    const fn = descriptor.value!;
    const prev: object[] = Reflect.getMetadata(RESPONSE_KEY, fn) ?? [];
    Reflect.defineMetadata(RESPONSE_KEY, [...prev, meta], fn);
    return descriptor;
  };
}

function makeApiTags(...tags: string[]): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(TAGS_KEY, tags, target);
  };
}

// Each test gets a fresh controller class to avoid metadata cross-contamination
// between test runs (Reflect metadata is stored on the function object itself).
function freshController() {
  return class FreshController {
    findAll() {}
    findOne(_id: string) {}
  };
}

describe('docs()', () => {
  it('applies class decorators to the constructor', () => {
    const Ctrl = freshController();
    docs(Ctrl, { classDecorators: [makeApiTags('my-tag')] });

    expect(Reflect.getMetadata(TAGS_KEY, Ctrl)).toEqual(['my-tag']);
  });

  it('applies method decorators to the correct method', () => {
    const Ctrl = freshController();
    docs(Ctrl, {
      methods: { findAll: [makeApiOperation({ summary: 'Get all' })] },
    });

    expect(Reflect.getMetadata(OPERATION_KEY, Ctrl.prototype.findAll)).toEqual({
      summary: 'Get all',
    });
  });

  it('does not affect other methods when decorating one', () => {
    const Ctrl = freshController();
    docs(Ctrl, {
      methods: { findAll: [makeApiOperation({ summary: 'List' })] },
    });

    expect(Reflect.getMetadata(OPERATION_KEY, Ctrl.prototype.findOne)).toBeUndefined();
  });

  it('accumulates multiple decorators on the same method in declaration order', () => {
    const Ctrl = freshController();
    docs(Ctrl, {
      methods: {
        findAll: [
          makeApiResponse({ status: 200, description: 'OK' }),
          makeApiResponse({ status: 404, description: 'Not found' }),
        ],
      },
    });

    const responses: object[] = Reflect.getMetadata(RESPONSE_KEY, Ctrl.prototype.findAll);
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ status: 200 });
    expect(responses[1]).toMatchObject({ status: 404 });
  });

  it('applies decorators to multiple methods in a single call', () => {
    const Ctrl = freshController();
    docs(Ctrl, {
      methods: {
        findAll: [makeApiOperation({ summary: 'List' })],
        findOne: [makeApiOperation({ summary: 'Get one' })],
      },
    });

    expect(Reflect.getMetadata(OPERATION_KEY, Ctrl.prototype.findAll)).toMatchObject({ summary: 'List' });
    expect(Reflect.getMetadata(OPERATION_KEY, Ctrl.prototype.findOne)).toMatchObject({ summary: 'Get one' });
  });

  it('applies both class and method decorators in a single call', () => {
    const Ctrl = freshController();
    docs(Ctrl, {
      classDecorators: [makeApiTags('combined')],
      methods: { findAll: [makeApiOperation({ summary: 'Combined' })] },
    });

    expect(Reflect.getMetadata(TAGS_KEY, Ctrl)).toEqual(['combined']);
    expect(Reflect.getMetadata(OPERATION_KEY, Ctrl.prototype.findAll)).toMatchObject({ summary: 'Combined' });
  });

  it('warns and skips when a method name does not exist', () => {
    const Ctrl = freshController();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    docs(Ctrl, {
      methods: { nonExistentMethod: [makeApiOperation({ summary: 'Oops' })] },
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"nonExistentMethod"'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('FreshController'));

    warnSpy.mockRestore();
  });

  it('does not throw when methods or classDecorators are omitted', () => {
    const Ctrl = freshController();
    expect(() => docs(Ctrl, {})).not.toThrow();
    expect(() => docs(Ctrl, { classDecorators: [] })).not.toThrow();
    expect(() => docs(Ctrl, { methods: {} })).not.toThrow();
  });
});
