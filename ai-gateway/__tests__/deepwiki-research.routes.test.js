const express = require('express');
const request = require('supertest');

jest.mock('axios', () => ({
  post: jest.fn(),
}));

jest.mock('../src/db/mysql', () => ({
  getSettings: jest.fn(),
}));

const axios = require('axios');
const db = require('../src/db/mysql');
const router = require('../src/routes/deepwiki-research');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/research', router);
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({
      success: false,
      error: error.message,
    });
  });
  return app;
}

describe('deepwiki research routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
    db.getSettings.mockResolvedValue({
      deepwiki_default_provider: 'weelinking_openai_compatible',
      deepwiki_qwen_enabled: true,
      deepwiki_weelinking_enabled: true,
      deepwiki_weelinking_default_model: 'deep-research',
      deepwiki_weelinking_base_url: 'https://api.weelinking.example',
      deepwiki_weelinking_api_key: 'secret-token',
      deepwiki_weelinking_wire_mode: 'openai_responses_compatible',
      deepwiki_codex_enabled: true,
      deepwiki_codex_default_model: 'gpt-5.4',
      deepwiki_codex_base_url: 'https://api.openai.example',
      deepwiki_codex_api_key: 'codex-secret',
    });
  });

  test('GET /deepwiki/providers returns enabled providers and default provider', async () => {
    const res = await request(app).get('/api/v1/research/deepwiki/providers');

    expect(res.status).toBe(200);
    expect(res.body.data.default_provider).toBe('weelinking_openai_compatible');
    expect(res.body.data.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'qwen_dashscope_native', enabled: true }),
        expect.objectContaining({ key: 'weelinking_openai_compatible', enabled: true, default_model: 'deep-research' }),
      ])
    );
  });

  test('GET /deepwiki/models returns fallback model list for provider', async () => {
    const res = await request(app).get('/api/v1/research/deepwiki/models').query({ provider: 'weelinking_openai_compatible' });

    expect(res.status).toBe(200);
    expect(res.body.data.provider).toBe('weelinking_openai_compatible');
    expect(res.body.data.default_model).toBe('deep-research');
    expect(res.body.data.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'deep-research' }),
        expect.objectContaining({ value: 'gpt-4.1' }),
      ])
    );
  });

  test('POST /deepwiki falls back from responses-compatible to chat-compatible when endpoint is unsupported', async () => {
    axios.post
      .mockRejectedValueOnce({
        message: 'Request failed with status code 404',
        response: {
          status: 404,
          data: {
            error: {
              message: 'Not Found',
            },
          },
        },
        config: {
          url: 'https://api.weelinking.example/v1/responses',
          method: 'post',
        },
      })
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: 'fallback summary',
              },
            },
          ],
        },
      });

    const res = await request(app)
      .post('/api/v1/research/deepwiki')
      .send({
        mode: 'summarize',
        provider: 'weelinking_openai_compatible',
        wire_mode: 'openai_responses_compatible',
        messages: [{ role: 'user', content: 'Summarize this repo.' }],
      });

    expect(res.status).toBe(200);
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[0][0]).toBe('https://api.weelinking.example/v1/responses');
    expect(axios.post.mock.calls[1][0]).toBe('https://api.weelinking.example/v1/chat/completions');
    expect(res.body.data.provider).toBe('weelinking_openai_compatible');
    expect(res.body.data.model).toBe('deep-research');
    expect(res.body.data.content).toBe('fallback summary');
  });

  test('POST /deepwiki does not hide codex network errors behind chat fallback', async () => {
    axios.post.mockRejectedValueOnce(
      Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
        config: {
          url: 'https://api.openai.com/v1/responses',
          method: 'post',
        },
      })
    );

    const res = await request(app)
      .post('/api/v1/research/deepwiki')
      .send({
        mode: 'diagram_synthesis',
        provider_strategy: 'codex_only',
        output_format: 'json',
        messages: [{ role: 'user', content: 'Generate diagrams.' }],
      });

    expect(res.status).toBe(502);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toBe('https://api.openai.example/v1/responses');
    expect(res.body.error).toContain('Codex upstream connection failed while reaching api.openai.com');
  });

  test('POST /deepwiki uses Codex for diagram_synthesis when provider_strategy is codex_only', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        output_text: '{"system_architecture":{"mermaid_source":"flowchart LR\\nA-->B"}}',
      },
    });

    const res = await request(app)
      .post('/api/v1/research/deepwiki')
      .send({
        mode: 'diagram_synthesis',
        provider_strategy: 'codex_only',
        output_format: 'json',
        messages: [{ role: 'user', content: 'Generate diagrams.' }],
      });

    expect(res.status).toBe(200);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toBe('https://api.openai.example/v1/responses');
    expect(res.body.data.provider).toBe('openai_codex_compatible');
    expect(res.body.data.model).toBe('gpt-5.4');
  });

  test('POST /deepwiki keeps explicit research_provider during diagram_synthesis', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              content: '{"system_architecture":{"mermaid_source":"flowchart LR\\nA-->B"}}',
            },
          },
        ],
      },
    });

    const res = await request(app)
      .post('/api/v1/research/deepwiki')
      .send({
        mode: 'diagram_synthesis',
        provider_strategy: 'codex_only',
        research_provider: 'weelinking_openai_compatible',
        wire_mode: 'openai_chat_compatible',
        output_format: 'json',
        messages: [{ role: 'user', content: 'Generate diagrams.' }],
      });

    expect(res.status).toBe(200);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toBe('https://api.weelinking.example/v1/chat/completions');
    expect(res.body.data.provider).toBe('weelinking_openai_compatible');
    expect(res.body.data.model).toBe('deep-research');
  });
});
