/**
 * @ruankao/exam-contracts - OpenAPI 3.0 Specification
 */

export const EXAM_OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'Ruankao Local Exam Web Service API',
    version: '1.0.0',
    description: 'Local 127.0.0.1 bound REST service for Ruankao exam preparation, session persistence, deterministic scoring, and spaced repetition review.'
  },
  servers: [
    {
      url: 'http://127.0.0.1:3000/api/v1',
      description: 'Local development / standalone server (127.0.0.1 only)'
    }
  ],
  paths: {
  "/agent-materials/export": {
    "post": {
      "summary": "Export a local Agent review task ZIP from submitted practice",
      "requestBody": {
        "required": true,
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "limit": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 100,
                  "default": 10
                },
                "subject": {
                  "type": "string",
                  "enum": [
                    "all",
                    "objective",
                    "case"
                  ],
                  "default": "all"
                }
              }
            }
          }
        }
      },
      "responses": {
        "200": {
          "description": "TASK.md, learning evidence, relevant chapters and local assets",
          "content": {
            "application/zip": {
              "schema": {
                "type": "string",
                "format": "binary"
              }
            }
          }
        },
        "400": {
          "description": "Invalid scope or no confirmed losses"
        },
        "413": {
          "description": "Task bundle too large"
        }
      }
    }
  },
  "/agent-materials/documents": {
    "get": {
      "summary": "List independently stored personal Markdown documents",
      "responses": {
        "200": {
          "description": "Document metadata list"
        }
      }
    },
    "post": {
      "summary": "Save a new personal Markdown document or append a version",
      "requestBody": {
        "required": true,
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "required": [
                "title",
                "markdown"
              ],
              "properties": {
                "id": {
                  "type": "string"
                },
                "baseVersion": {
                  "type": "integer",
                  "minimum": 1,
                  "description": "Required when updating an existing document"
                },
                "title": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 120
                },
                "markdown": {
                  "type": "string",
                  "description": "Self-contained Markdown, at most 2 MiB UTF-8; plain-text or Unicode formulas"
                }
              }
            }
          }
        }
      },
      "responses": {
        "201": {
          "description": "Personal Markdown document with version history",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "data": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "400": {
          "description": "Invalid document"
        },
        "409": {
          "description": "Current version differs from baseVersion; refresh and preview before saving"
        },
        "413": {
          "description": "Markdown exceeds 2 MiB"
        }
      }
    }
  },
  "/agent-materials/documents/{id}": {
    "get": {
      "summary": "Read current or historical personal Markdown",
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          }
        },
        {
          "name": "version",
          "in": "query",
          "schema": {
            "type": "integer",
            "minimum": 1
          }
        }
      ],
      "responses": {
        "200": {
          "description": "Personal Markdown document with version history",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "data": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "404": {
          "description": "Document or version does not exist"
        }
      }
    }
  },
  "/agent-materials/documents/{id}/restore": {
    "post": {
      "summary": "Restore historical content by appending a new version",
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          }
        }
      ],
      "requestBody": {
        "required": true,
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "required": [
                "version",
                "baseVersion"
              ],
              "properties": {
                "version": {
                  "type": "integer",
                  "minimum": 1
                },
                "baseVersion": {
                  "type": "integer",
                  "minimum": 1
                }
              }
            }
          }
        }
      },
      "responses": {
        "201": {
          "description": "Personal Markdown document with version history",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "data": {
                    "type": "object"
                  }
                }
              }
            }
          }
        },
        "404": {
          "description": "Document or version does not exist"
        },
        "409": {
          "description": "Current version differs from baseVersion; refresh and preview before saving"
        }
      }
    }
  },
    '/health': {
      get: {
        summary: 'Check service health and database connection status',
        responses: {
          '200': {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    boundAddress: { type: 'string', example: '127.0.0.1' },
                    uptime: { type: 'number' },
                    db: { type: 'string', example: 'connected' },
                    verifiedPapersCount: { type: 'number', example: 10 }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/papers': {
      get: {
        summary: 'List available verified exam papers (read-only pilot set)',
        parameters: [
          {
            name: 'subject',
            in: 'query',
            schema: { type: 'string', enum: ['objective', 'case'] },
            required: false,
            description: 'Filter by subject type'
          }
        ],
        responses: {
          '200': {
            description: 'List of papers',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/PaperSummary' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/papers/{id}': {
      get: {
        summary: 'Get paper metadata and sanitized questions (answers stripped)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Paper details with sanitized questions',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/PaperDetail' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/chapters': {
      get: {
        summary: 'List chapters and question count distribution',
        responses: {
          '200': {
            description: 'List of chapters',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          chapter: { type: 'string' },
                          objectiveCount: { type: 'number' },
                          caseCount: { type: 'number' }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/sessions': {
      post: {
        summary: 'Create a new exam session',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateSessionRequest' }
            }
          }
        },
        responses: {
          '201': {
            description: 'Session created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/ExamSession' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/sessions/{id}': {
      get: {
        summary: 'Get session state, sanitized questions, and saved answers for resuming',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' }
          }
        ],
        responses: {
          '200': {
            description: 'Session resumption state',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        session: { $ref: '#/components/schemas/ExamSession' },
                        questions: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/SanitizedQuestion' }
                        },
                        answers: {
                          type: 'object',
                          additionalProperties: { type: 'string' },
                          description: 'Map of questionId to user draft answer'
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/sessions/{id}/answers': {
      post: {
        summary: 'Save or update answer draft (idempotent)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SaveAnswerDraftRequest' }
            }
          }
        },
        responses: {
          '200': {
            description: 'Answer saved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/ExamAnswerRecord' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/sessions/{id}/submit': {
      post: {
        summary: 'Submit exam session, grade objective questions, update wrong questions & review queue, generate report',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' }
          }
        ],
        responses: {
          '200': {
            description: 'Exam submitted, returns full report with answers and explanations',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/SessionReport' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/sessions/{id}/regrade': {
      post: {
        summary: 'Score pending and legacy rule-graded case answers with LLM, refresh report and personal materials',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Updated session report', content: { 'application/json': {
            schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/SessionReport' } } }
          } } },
          '503': { description: 'LLM scoring unavailable; saved answers and results unchanged' }
        }
      }
    },
    '/sessions/{id}/report': {
      get: {
        summary: 'Get report of a submitted session',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' }
          }
        ],
        responses: {
          '200': {
            description: 'Session report',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/SessionReport' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/wrong-questions': {
      get: {
        summary: 'List wrong questions with filtering',
        parameters: [
          { name: 'chapter', in: 'query', schema: { type: 'string' } },
          { name: 'mastered', in: 'query', schema: { type: 'boolean' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }
        ],
        responses: {
          '200': {
            description: 'List of wrong questions',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/WrongQuestionRecord' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/wrong-questions/{id}/mastered': {
      post: {
        summary: 'Toggle mastered status of a wrong question',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  mastered: { type: 'boolean' }
                },
                required: ['mastered']
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Status updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/WrongQuestionRecord' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/review-queue': {
      get: {
        summary: 'Get spaced repetition review queue items sorted by priority',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }
        ],
        responses: {
          '200': {
            description: 'Review queue items',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ReviewQueueRecord' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  components: {
    schemas: {
      PaperSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          year: { type: 'number' },
          season: { type: 'string' },
          subject: { type: 'string', enum: ['objective', 'case'] },
          totalQuestions: { type: 'number' },
          standardQuestionGroups: { type: 'number' },
          sourceUrl: { type: 'string' }
        },
        required: ['id', 'title', 'year', 'season', 'subject', 'totalQuestions']
      },
      PaperDetail: {
        allOf: [
          { $ref: '#/components/schemas/PaperSummary' },
          {
            type: 'object',
            properties: {
              questions: {
                type: 'array',
                items: { $ref: '#/components/schemas/SanitizedQuestion' }
              }
            }
          }
        ]
      },
      SanitizedQuestion: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          standardId: { type: 'string' },
          paperId: { type: 'string' },
          subject: { type: 'string', enum: ['objective', 'case'] },
          chapter: { type: 'string' },
          sourceAnchor: { type: 'string' },
          questionStem: { type: 'string', description: 'Present for objective' },
          sharedStem: { type: 'string', description: 'Present for case' },
          subQuestions: {
            type: 'array',
            description: 'Case prompts only; answers and analysis are excluded',
            items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, stem: { type: 'string' } } }
          },
          caseTitle: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                text: { type: 'string' }
              }
            }
          },
          codeBlocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['stem'] },
                code: { type: 'string' },
                language: { type: 'string' }
              }
            }
          },
          images: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['stem'] },
                localPath: { type: 'string' },
                sha256: { type: 'string' },
                sourceUrl: { type: 'string' }
              }
            }
          }
        },
        required: ['id', 'standardId', 'paperId', 'subject', 'chapter']
      },
      CreateSessionRequest: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['paper', 'chapter', 'wrong_questions'] },
          paperId: { type: 'string' },
          chapter: { type: 'string' },
          questionIds: { type: 'array', items: { type: 'string' } },
          title: { type: 'string' }
        },
        required: ['mode']
      },
      ExamSession: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          sessionMode: { type: 'string' },
          paperId: { type: 'string', nullable: true },
          chapter: { type: 'string', nullable: true },
          title: { type: 'string' },
          totalQuestions: { type: 'number' },
          answeredCount: { type: 'number' },
          status: { type: 'string', enum: ['in_progress', 'submitted'] },
          score: { type: 'number', nullable: true },
          maxScore: { type: 'number' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          submittedAt: { type: 'string', format: 'date-time', nullable: true }
        }
      },
      SaveAnswerDraftRequest: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', format: 'uuid' },
          questionId: { type: 'string' },
          questionType: { type: 'string', enum: ['objective', 'case'] },
          userAnswer: {
            oneOf: [
              { type: 'string' },
              { type: 'object', additionalProperties: { type: 'string' } }
            ]
          }
        },
        required: ['sessionId', 'questionId', 'questionType', 'userAnswer']
      },
      ExamAnswerRecord: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sessionId: { type: 'string' },
          questionId: { type: 'string' },
          questionType: { type: 'string' },
          userAnswer: { type: 'string' },
          isCorrect: { type: 'boolean', nullable: true },
          score: { type: 'number', nullable: true },
          maxScore: { type: 'number' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' }
        }
      },
      SessionReport: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          sessionMode: { type: 'string' },
          paperId: { type: 'string', nullable: true },
          chapter: { type: 'string', nullable: true },
          title: { type: 'string' },
          status: { type: 'string' },
          score: { type: 'number', nullable: true },
          maxScore: { type: 'number' },
          accuracy: { type: 'number', nullable: true },
          pendingScoringCount: { type: 'integer' },
          canRegrade: { type: 'boolean' },
          totalQuestions: { type: 'number' },
          answeredCount: { type: 'number' },
          correctCount: { type: 'number' },
          wrongCount: { type: 'number' },
          submittedAt: { type: 'string' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { $ref: '#/components/schemas/SanitizedQuestion' },
                userAnswer: { type: 'string' },
                effectiveAnswer: { type: 'string' },
                isCorrect: { type: 'boolean', nullable: true },
                score: { type: 'number', nullable: true },
                status: { type: 'string', enum: ['correct', 'wrong', 'unanswered', 'case', 'unselected', 'pending_scoring'] },
                pendingScoring: { type: 'boolean' },
                canRegrade: { type: 'boolean' },
                scoringMessage: { type: 'string' },
                maxScore: { type: 'number' },
                analysis: { type: 'string' },
                materialAnchor: {
                  type: 'object',
                  properties: {
                    chapter: { type: 'string' },
                    relativeDocPath: { type: 'string' },
                    anchorHeading: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      },
      WrongQuestionRecord: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          questionId: { type: 'string' },
          paperId: { type: 'string' },
          chapter: { type: 'string' },
          questionType: { type: 'string' },
          firstWrongAt: { type: 'string' },
          lastWrongAt: { type: 'string' },
          wrongCount: { type: 'number' },
          mastered: { type: 'boolean' },
          lastReviewedAt: { type: 'string', nullable: true }
        }
      },
      ReviewQueueRecord: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          questionId: { type: 'string' },
          priorityScore: { type: 'number' },
          nextReviewAt: { type: 'string' },
          intervalDays: { type: 'number' },
          repetitions: { type: 'number' },
          easeFactor: { type: 'number' },
          state: { type: 'string' },
          updatedAt: { type: 'string' }
        }
      }
    }
  }
};
