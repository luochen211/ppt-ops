# Architecture

```text
project sources
      |
      v
project loader ---> shared validation
      |                    |
      v                    v
 normalized project + page-spec
      |                    |
      v                    v
 HTML renderer        PPTX renderer
      |                    |
      v                    v
 HTML checks          PPTX checks
       \                  /
        v                v
          review report
                |
                v
             handoff
```

## Boundaries

- `core/` owns shared project semantics and validation.
- `adapters/html/` owns browser presentation output.
- `adapters/pptx/` owns editable PowerPoint output.
- `review/` observes outputs and reports evidence; it does not silently repair them.
- `cli/` orchestrates commands but does not contain renderer logic.

The shared contract is an upstream dependency. Renderer implementations can proceed in parallel after that contract is stable.
