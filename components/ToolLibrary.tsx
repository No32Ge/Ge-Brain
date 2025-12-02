// src/components/ToolLibrary.tsx
import { UserTool } from '../types';

export const PRESET_TOOLS: Omit<UserTool, 'id'>[] = [
  {
    active: true,
    definition: {
      name: 'query_dom',
      description: '查询DOM元素',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS选择器'
          }
        },
        required: ['selector']
      }
    },
    implementation: `// 查询DOM元素
const elements = document.querySelectorAll(args.selector);
return {
  count: elements.length,
  found: elements.length > 0
};`,
    autoExecute: true,
    category: 'dom'
  },
  {
    active: true,
    definition: {
      name: 'click_element',
      description: '点击页面元素',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS选择器'
          }
        },
        required: ['selector']
      }
    },
    implementation: `// 点击元素
const element = document.querySelector(args.selector);
if (element) {
  element.click();
  return { success: true, clicked: true };
}
return { success: false, error: '元素未找到' };`,
    autoExecute: true,
    category: 'dom'
  },
  {
    active: true,
    definition: {
      name: 'get_page_info',
      description: '获取页面信息',
      parameters: {
        type: 'object',
        properties: {}
      }
    },
    implementation: `// 获取页面信息
return {
  title: document.title,
  url: window.location.href,
  timestamp: Date.now()
};`,
    autoExecute: true,
    category: 'page'
  }
];


export const TOOL_CATEGORIES = {
  dom: 'DOM操作',
  page: '页面控制',
  storage: '存储管理',
  custom: '自定义'
};