import { OpenAPIParser } from '../parser';

const SPEC = {
  openapi: '3.0.0',
  info: { title: 'Pet Store', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'A list of pets',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PetList' } } },
          },
        },
      },
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/NewPet' } } },
        },
        responses: { '201': { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } },
      },
      head: {
        operationId: 'checkPets',
        responses: { '204': { description: 'No content' } },
      },
    },
    '/pets/{id}': {
      get: {
        operationId: 'getPet',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'A pet', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } } },
      },
      options: {
        operationId: 'petOptions',
        responses: { '204': { description: 'No content' } },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          tag: { type: 'string' },
          status: { type: 'string', enum: ['available', 'pending', 'sold'] },
        },
      },
      NewPet: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          tag: { type: 'string' },
        },
      },
      PetList: {
        type: 'object',
        required: ['items'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
          total: { type: 'integer' },
        },
      },
      ErrorWithBase: {
        allOf: [
          { $ref: '#/components/schemas/NewPet' },
          { type: 'object', properties: { code: { type: 'integer' } } },
        ],
      },
    },
  },
};

describe('OpenAPIParser', () => {
  let parser: OpenAPIParser;

  beforeEach(() => {
    parser = new OpenAPIParser();
    parser.parse(SPEC);
  });

  test('resolves a direct $ref', () => {
    const schema = parser.resolveRef('#/components/schemas/Pet');
    expect(schema.type).toBe('object');
    expect(schema.properties?.['id']).toBeDefined();
  });

  test('resolveSchema follows $ref and annotates x-schema-name', () => {
    const resolved = parser.resolveSchema({ $ref: '#/components/schemas/Pet' });
    expect(resolved['x-schema-name']).toBe('Pet');
    expect(resolved.properties?.['name']).toBeDefined();
  });

  test('resolveSchema merges allOf', () => {
    const resolved = parser.resolveSchema({ $ref: '#/components/schemas/ErrorWithBase' });
    expect(resolved.properties?.['name']).toBeDefined();  // from NewPet
    expect(resolved.properties?.['code']).toBeDefined();  // from inline
  });

  test('resolveSchema recurses into array items', () => {
    const listResolved = parser.resolveSchema({ $ref: '#/components/schemas/PetList' });
    const items = listResolved.properties?.['items'];
    expect(items?.type).toBe('array');
    expect(items?.items?.['x-schema-name']).toBe('Pet');
  });

  test('getModels returns topologically sorted models', () => {
    const models = parser.getModels();
    const names = models.map((m) => m.name);
    // PetList depends on Pet, so Pet must come first
    expect(names.indexOf('Pet')).toBeLessThan(names.indexOf('PetList'));
  });

  test('getOperations returns all methods', () => {
    const ops = parser.getOperations(SPEC as never);
    expect(ops).toHaveLength(5);
    expect(ops.map((o) => o.operation.operationId)).toEqual([
      'listPets',
      'createPet',
      'checkPets',
      'getPet',
      'petOptions',
    ]);
  });

  test('getResponseSchema resolves $ref on response', () => {
    const ops = parser.getOperations(SPEC as never);
    const listOp = ops.find((o) => o.operation.operationId === 'listPets')!;
    const schema = parser.getResponseSchema(listOp.operation);
    expect(schema?.['x-schema-name']).toBe('PetList');
  });

  test('getRequestBodySchema resolves $ref on request body', () => {
    const ops = parser.getOperations(SPEC as never);
    const createOp = ops.find((o) => o.operation.operationId === 'createPet')!;
    const schema = parser.getRequestBodySchema(createOp.operation);
    expect(schema?.['x-schema-name']).toBe('NewPet');
  });

  test('circular ref does not infinite loop', () => {
    const circularSpec = {
      ...SPEC,
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              child: { $ref: '#/components/schemas/Node' },
            },
          },
        },
      },
    };
    const p2 = new OpenAPIParser();
    p2.parse(circularSpec);
    expect(() => p2.resolveSchema({ $ref: '#/components/schemas/Node' })).not.toThrow();
  });

  test('throws on invalid spec', () => {
    const p2 = new OpenAPIParser();
    expect(() => p2.parse({ openapi: '3.0.0' })).toThrow('missing required fields');
  });
});
