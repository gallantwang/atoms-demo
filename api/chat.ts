// api/chat.ts
export const config = {
    runtime: 'edge', // 关键！用 Edge Runtime 解决 Vercel 访问国内 API 超时的问题
  };
  
  export default async function handler(req: Request) {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }
  
    try {
      // 模型名称已根据你的截图修改为 glm-5.3-flash
      const { messages, model = 'glm-5.3-flash' } = await req.json();
  
      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.ZHIPU_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          stream: true, // 开启流式输出
        }),
      });
  
      if (!response.ok) {
        const error = await response.text();
        return new Response(JSON.stringify({ error }), { 
          status: response.status, 
          headers: { 'Content-Type': 'application/json' } 
        });
      }
  
      // 直接把智谱的流式数据透传给前端
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
  }