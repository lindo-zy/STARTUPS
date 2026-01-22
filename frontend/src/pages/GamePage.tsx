import React from 'react';
import { Link } from 'react-router-dom';

const GamePage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-800">游戏页面</h1>
        
        <div className="space-y-6">
          <div className="text-center">
            <p className="text-gray-600 mb-4">游戏功能正在开发中...</p>
            <div className="w-full h-48 bg-gray-200 rounded-md flex items-center justify-center">
              <p className="text-gray-500">游戏区域</p>
            </div>
          </div>
          
          {/* 返回游戏大厅按钮 */}
          <div>
            <Link to="/">
              <button 
                className="w-full bg-gray-500 hover:bg-gray-600 text-white font-medium py-3 px-4 rounded-md transition-colors"
              >
                返回游戏大厅
              </button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GamePage;