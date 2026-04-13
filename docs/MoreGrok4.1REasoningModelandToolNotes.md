**Short Writeup: Optimizing Tool Presentation for Grok 4.1 Fast Reasoning**

Grok 4.1 Fast Reasoning is xAI’s strongest agentic tool-calling model. It excels at parallel tool use, complex workflows, and real-world tasks, but it performs best when tools are presented clearly and consistently.

### Best Practices for Tool Presentation

1. **Use clean, descriptive JSON schemas**  
   - Keep descriptions concise but specific (1–2 sentences max).  
   - Always include what the tool returns and any important constraints.  
   - Example:  
     ```json
     {
       "name": "web_search",
       "description": "Search the web and return the top results with titles, URLs, and short summaries.",
       "parameters": { ... }
     }
     ```

2. **Limit the number of tools per turn**  
   - Grok 4.1 Fast Reasoning handles ~10–15 tools comfortably in one call.  
   - More than 20 can degrade performance. Use the model profile system (0b) to dynamically mask tools based on the query.

3. **Consistent naming & structure**  
   - Prefer `snake_case_with_domain_prefix` (e.g., `outlook_list_emails`, `github_create_issue`).  
   - Group related tools together in the schema array when possible.

4. **Progressive reveal where helpful**  
   - For very large toolsets, start with a small core set and let the model request more via follow-up turns.

5. **Strong parameter descriptions**  
   - Clearly document required vs optional fields and expected formats (especially for complex objects).

6. **Avoid ambiguity**  
   - Never rely on the model “figuring out” what a tool does. Explicit descriptions win.

### OpenRouter Specifics – Toggling Reasoning

When calling Grok 4.1 Fast via **OpenRouter**, you have two ways to control reasoning:

- **Preferred method (model selection):**  
  Use the specific model ID:  
  - `x-ai/grok-4.1-fast-reasoning` → Reasoning enabled (recommended for complex agentic tasks)  
  - `x-ai/grok-4.1-fast` or `x-ai/grok-4.1-fast-non-reasoning` → Reasoning disabled (faster, cheaper for simple queries)

- **API parameter method:**  
  You can also control it at request time using the `reasoning` parameter:  
  ```json
  {
    "model": "x-ai/grok-4.1-fast",
    "reasoning": { "enabled": true }   // or false
  }
  ```

**Recommendation for your swarm:**
- Use the `-reasoning` model variant for the **Leader (Grok)** and any agent doing complex planning or synthesis.
- Use the non-reasoning or fast variant for lightweight workers (e.g., simple data extraction) to save cost and latency.

**Here are detailed, production-grade JSON tool schema examples** optimized specifically for **Grok 4.1 Fast Reasoning**.

These examples follow the best practices we discussed:
- Clear, specific descriptions
- Consistent snake_case naming
- Well-documented parameters
- Proper required/optional fields
- Concise but informative

### 1. `web_search` – Core search tool

```json
{
  "type": "function",
  "function": {
    "name": "web_search",
    "description": "Perform a web search and return the top results with titles, URLs, and short descriptions.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "The search query. Can include operators like site:reddit.com or filetype:pdf."
        },
        "num_results": {
          "type": "integer",
          "description": "Number of results to return (1-20).",
          "default": 10,
          "minimum": 1,
          "maximum": 20
        }
      },
      "required": ["query"]
    }
  }
}
```

### 2. `browse_page` – Deep extraction tool (critical for Harper)

```json
{
  "type": "function",
  "function": {
    "name": "browse_page",
    "description": "Fetch a webpage and extract specific information using precise instructions.",
    "parameters": {
      "type": "object",
      "properties": {
        "url": {
          "type": "string",
          "description": "The full URL of the page to browse."
        },
        "instructions": {
          "type": "string",
          "description": "Detailed instructions for what to extract (e.g., 'Extract the exact address, phone number, and whether they mention FOX certification')."
        }
      },
      "required": ["url", "instructions"]
    }
  }
}
```

### 3. `code_execution` – Math & analysis tool (critical for Lucas)

```json
{
  "type": "function",
  "function": {
    "name": "code_execution",
    "description": "Execute Python 3.12 code in a secure stateful REPL. Supports numpy, pandas, sympy, matplotlib, and other scientific libraries.",
    "parameters": {
      "type": "object",
      "properties": {
        "code": {
          "type": "string",
          "description": "The Python code to execute. Variables persist across calls within the same session."
        }
      },
      "required": ["code"]
    }
  }
}
```

### 4. `chatroom_send` – Core swarm communication tool

```json
{
  "type": "function",
  "function": {
    "name": "chatroom_send",
    "description": "Send a message to one or more agents in the current swarm for real-time collaboration.",
    "parameters": {
      "type": "object",
      "properties": {
        "message": {
          "type": "string",
          "description": "The message content. Can include partial results, questions, or status updates."
        },
        "to": {
          "description": "Recipient(s): 'Grok', 'Benjamin', 'Harper', 'Lucas', 'All', or an array of names.",
          "anyOf": [
            { "type": "string", "enum": ["Grok", "Benjamin", "Harper", "Lucas", "All"] },
            { "type": "array", "items": { "type": "string", "enum": ["Grok", "Benjamin", "Harper", "Lucas"] } }
          ]
        }
      },
      "required": ["message", "to"]
    }
  }
}
```

### 5. `outlook_list_emails` – Enterprise tool example (sub-session aware)

```json
{
  "type": "function",
  "function": {
    "name": "outlook_list_emails",
    "description": "Search the user's Outlook inbox and return matching emails. Requires a delegated sub-session with read permissions.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Search query (e.g., 'from:boss@company.com has:attachment')."
        },
        "max_results": {
          "type": "integer",
          "description": "Maximum number of emails to return.",
          "default": 10,
          "minimum": 1,
          "maximum": 50
        },
        "since": {
          "type": "string",
          "description": "Optional ISO date to filter emails received after this date."
        }
      },
      "required": ["query"]
    }
  }
}
```

### 6. `conversation_search` – RAG tool for past context

```json
{
  "type": "function",
  "function": {
    "name": "conversation_search",
    "description": "Search past conversations and swarm sessions for relevant context using semantic similarity.",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Semantic search query over previous interactions."
        },
        "limit": {
          "type": "integer",
          "description": "Maximum number of relevant results to return.",
          "default": 5,
          "minimum": 1,
          "maximum": 15
        }
      },
      "required": ["query"]
    }
  }
}
```

These schemas are ready to use in your tool registry and model profiles. Would you like me to add more examples (e.g., GitHub tools, Azure tools, or image-related tools)? Or would you like a version formatted specifically for your capability manifests?
