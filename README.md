# n8n-nodes-rdraw

Community node for [n8n](https://n8n.io) that integrates with the [rDraw](https://rdraw.io) document generation API. Generate **PDF**, **XLSX** or **DOCX** reports from rDraw templates directly inside your workflows.

[![npm version](https://img.shields.io/npm/v/n8n-nodes-rdraw.svg)](https://www.npmjs.com/package/n8n-nodes-rdraw)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)

---

## Installation

### Option 1 — From the n8n UI (recommended)

1. Open your n8n instance.
2. Go to **Settings → Community Nodes → Install**.
3. Enter the package name:

   ```
   n8n-nodes-rdraw
   ```

4. Accept the risk warning and click **Install**.

The **rDraw** node will appear in the nodes panel.

### Option 2 — Self-hosted (Docker)

Make sure community packages are enabled:

```bash
docker run -it --rm \
  -p 5678:5678 \
  -v n8n_data:/home/node/.n8n \
  -e N8N_COMMUNITY_PACKAGES_ENABLED=true \
  docker.n8n.io/n8nio/n8n
```

Then install via the UI as above.

---

## Credentials

Create a new credential of type **rDraw API** and paste your API key. The key is sent automatically as the `X-API-Key` header on every request.

You can request an API key at [rdraw.io](https://rdraw.io).

---

## Node: rDraw

Generates a report by calling `POST https://api.rdraw.io/api/generate` and returns the resulting file as binary data, ready to be saved, emailed, or uploaded to cloud storage.

### Parameters

| Field             | Description                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Report ID**     | UUID of the rDraw template (e.g. `edc6fe12-49f5-458b-aa23-d6954e005266`).                                                         |
| **Format**        | Output format — `PDF`, `XLSX`, or `DOCX`.                                                                                         |
| **Data Sources**  | JSON object whose keys are the dataSource names defined in the template, and values are arrays of records.                        |
| **Binary Property** | Name of the binary property where the generated file will be placed (default: `data`).                                          |
| **File Name**     | File name without extension (default: `report`). The extension is added automatically based on the chosen format.                 |

### Example — Data Sources

```json
{
  "Alunos": [
    {
      "nome": "Ana Pereira",
      "numero": 1,
      "nota_trimestre1": 14,
      "nota_trimestre2": 15,
      "nota_trimestre3": 16,
      "media_final": 15
    }
  ]
}
```

### Output

Each input item produces an output item with:

- `json`: `{ success, reportId, format, fileName }`
- `binary.<binaryPropertyName>`: the generated file (PDF / XLSX / DOCX)

You can chain the output directly into nodes like **Write Binary File**, **Google Drive**, **S3**, **Send Email**, etc.

---

## Example workflow

1. **Trigger** (Webhook / Schedule / Manual)
2. **Set / Code** — build the `dataSources` object.
3. **rDraw** — Report ID + Format + Data Sources.
4. **Google Drive** (or any binary-consuming node) — upload the file.

---

## API reference

The node wraps a single endpoint:

```bash
curl -X POST "https://api.rdraw.io/api/generate" \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "reportId": "edc6fe12-49f5-458b-aa23-d6954e005266",
    "format": "pdf",
    "dataSources": {
      "Alunos": [ { "nome": "Ana", "numero": 1 } ]
    }
  }'
```

The response is `{ "success": true, "data": "<base64>" }`. The node decodes `data` automatically into a binary file.

Full docs: [rdraw.io/docs](https://rdraw.io/docs).

---

## Development

```bash
git clone https://github.com/rdraw-io/n8n-node.git
cd n8n-node
npm install
npm run dev      # starts n8n with hot reload
```

Other scripts:

```bash
npm run lint        # n8n community-node lint rules
npm run build       # compile to dist/
npm run release     # bump version, tag, publish to npm
```

---

## License

[MIT](LICENSE.md) © RDraw
