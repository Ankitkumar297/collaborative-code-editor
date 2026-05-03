import { executeCode } from '../services/execute.service.js';

export const runCode = async (req, res) => {
  const { code, language } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }

  try {
    const output = await executeCode(code, language);
    res.json({ output });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Execution failed' });
  }
};
