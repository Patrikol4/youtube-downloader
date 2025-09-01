
// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const youtubeDl = require('youtube-dl-exec');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Criar diretório de downloads se não existir
const downloadsDir = path.join(__dirname, 'downloads');
fs.ensureDirSync(downloadsDir);

// Rota principal - serve o HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota para analisar vídeo
app.post('/api/analyze', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url || !isValidYouTubeUrl(url)) {
      return res.status(400).json({ error: 'URL inválida do YouTube' });
    }

    console.log('Analisando URL:', url);
    
    // Obter informações do vídeo
    const info = await youtubeDl(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: ['referer:youtube.com', 'user-agent:googlebot']
    });

    // Extrair formatos disponíveis
    const formats = info.formats
      .filter(format => format.ext === 'mp4' || format.acodec !== 'none')
      .map(format => ({
        format_id: format.format_id,
        ext: format.ext,
        quality: format.height ? `${format.height}p` : 'audio',
        filesize: format.filesize,
        vcodec: format.vcodec,
        acodec: format.acodec
      }));

    const videoData = {
      id: info.id,
      title: info.title,
      channel: info.uploader,
      duration: formatDuration(info.duration),
      views: formatViews(info.view_count),
      thumbnail: info.thumbnail,
      formats: formats
    };

    res.json(videoData);

  } catch (error) {
    console.error('Erro ao analisar vídeo:', error);
    res.status(500).json({ 
      error: 'Erro ao processar vídeo. Verifique se o link está correto.' 
    });
  }
});

// Rota para download
app.post('/api/download', async (req, res) => {
  try {
    const { url, quality, format_id } = req.body;
    
    if (!url || !isValidYouTubeUrl(url)) {
      return res.status(400).json({ error: 'URL inválida do YouTube' });
    }

    console.log('Iniciando download:', { url, quality, format_id });

    // Obter informações básicas do vídeo para o nome do arquivo
    const info = await youtubeDl(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true
    });

    const safeTitle = info.title.replace(/[^\w\s-]/g, '').trim();
    const fileName = `${safeTitle}_${quality}`;
    
    let downloadOptions = {
      noCheckCertificates: true,
      noWarnings: true,
      addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
      output: path.join(downloadsDir, `${fileName}.%(ext)s`)
    };

    // Configurar opções baseadas na qualidade
    if (quality === 'audio') {
      downloadOptions.extractAudio = true;
      downloadOptions.audioFormat = 'mp3';
      downloadOptions.audioQuality = '192K';
    } else if (format_id) {
      downloadOptions.format = format_id;
    } else {
      // Fallback para qualidade específica
      downloadOptions.format = `best[height<=${quality.replace('p', '')}]`;
    }

    // Executar download
    const output = await youtubeDl(url, downloadOptions);
    
    // Encontrar o arquivo baixado
    const files = await fs.readdir(downloadsDir);
    const downloadedFile = files.find(file => 
      file.includes(safeTitle) && 
      (file.includes(quality) || file.endsWith('.mp3'))
    );

    if (!downloadedFile) {
      throw new Error('Arquivo baixado não encontrado');
    }

    const filePath = path.join(downloadsDir, downloadedFile);
    const stats = await fs.stat(filePath);

    res.json({
      success: true,
      filename: downloadedFile,
      size: formatFileSize(stats.size),
      downloadUrl: `/download/${encodeURIComponent(downloadedFile)}`
    });

  } catch (error) {
    console.error('Erro no download:', error);
    res.status(500).json({ 
      error: 'Erro ao fazer download do vídeo. Tente novamente.' 
    });
  }
});

// Rota para servir arquivos de download
app.get('/download/:filename', async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(downloadsDir, filename);
    
    // Verificar se o arquivo existe
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }

    // Definir headers para download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    
    // Stream do arquivo
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    // Limpar arquivo após download (opcional)
    fileStream.on('end', () => {
      setTimeout(() => {
        fs.remove(filePath).catch(console.error);
      }, 5000); // Remove após 5 segundos
    });

  } catch (error) {
    console.error('Erro ao servir arquivo:', error);
    res.status(500).json({ error: 'Erro ao acessar arquivo' });
  }
});

// Funções utilitárias
function isValidYouTubeUrl(url) {
  const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
  return youtubeRegex.test(url);
}

function formatDuration(seconds) {
  if (!seconds) return 'N/A';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatViews(count) {
  if (!count) return 'N/A';
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

function formatFileSize(bytes) {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
});

