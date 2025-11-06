const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const PORT = 5000;

const CHECK_INTERVAL = 3000;
const WAIT_AFTER_RESULT = 5000;
const LEARNING_DATA_FILE = './sunwin_learning_data.json';

let currentPrediction = null;
let predictionHistory = [];
let lastProcessedPhien = null;
let historyCache = { data: [], timestamp: 0 };
const CACHE_TTL = 2000;
const MAX_HISTORY = 500;
let breakDetectionData = { consecutiveWrong: 0, suspiciousPatterns: [], riskLevel: 'low' };

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(LEARNING_DATA_FILE, 'utf8'));
      console.log('✅ Đã load dữ liệu học tập Sun.win từ file');
      return data;
    }
  } catch (error) {
    console.log('⚠️ Không thể load learning data Sun.win, tạo mới');
  }
  return {};
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_DATA_FILE, JSON.stringify(patternLearningData, null, 2));
  } catch (error) {
    console.error('❌ Lỗi khi lưu learning data Sun.win:', error.message);
  }
}

let patternLearningData = loadLearningData();

const defaultPatterns = [
  'cau_bet', 'cau_dao_1_1', 'cau_1_2_3', 'cau_3_2_1', 'cau_2_2', 'cau_2_1_2',
  'nhip_nghieng_5', 'nhip_nghieng_7', 'gap_thep_martingale',
  'phan_tich_tong', 'phan_tich_xuc_xac', 'xu_huong_manh', 'cau_nhay', 'cau_lech',
  'fibonacci', 'break_reversal', 'pattern_correlation', 'house_intervention',
  'odd_even_analysis', 'total_sum_trend'
];

defaultPatterns.forEach(pattern => {
  if (!patternLearningData[pattern]) {
    patternLearningData[pattern] = { 
      total: 0, 
      correct: 0, 
      confidence_adjustment: 0,
      recent_performance: []
    };
  }
});

function updatePatternLearning(pattern, isCorrect) {
  if (!patternLearningData[pattern]) {
    patternLearningData[pattern] = { 
      total: 0, 
      correct: 0, 
      confidence_adjustment: 0,
      recent_performance: []
    };
  }
  
  patternLearningData[pattern].total++;
  if (isCorrect) {
    patternLearningData[pattern].correct++;
  }
  
  if (!patternLearningData[pattern].recent_performance) {
    patternLearningData[pattern].recent_performance = [];
  }
  patternLearningData[pattern].recent_performance.unshift(isCorrect ? 1 : 0);
  if (patternLearningData[pattern].recent_performance.length > 20) {
    patternLearningData[pattern].recent_performance.pop();
  }
  
  const accuracy = patternLearningData[pattern].correct / patternLearningData[pattern].total;
  
  let recentAccuracy = accuracy;
  if (patternLearningData[pattern].recent_performance.length >= 5) {
    const recent = patternLearningData[pattern].recent_performance;
    let weightedSum = 0;
    let weightTotal = 0;
    recent.forEach((val, idx) => {
      const weight = 1 / (idx + 1);
      weightedSum += val * weight;
      weightTotal += weight;
    });
    recentAccuracy = weightedSum / weightTotal;
  }
  
  const finalAccuracy = (accuracy * 0.4) + (recentAccuracy * 0.6);
  
  if (patternLearningData[pattern].total >= 3) {
    if (finalAccuracy >= 0.75) {
      patternLearningData[pattern].confidence_adjustment = +8;
    } else if (finalAccuracy >= 0.65) {
      patternLearningData[pattern].confidence_adjustment = +5;
    } else if (finalAccuracy >= 0.58) {
      patternLearningData[pattern].confidence_adjustment = +3;
    } else if (finalAccuracy >= 0.52) {
      patternLearningData[pattern].confidence_adjustment = 0;
    } else if (finalAccuracy >= 0.45) {
      patternLearningData[pattern].confidence_adjustment = -3;
    } else if (finalAccuracy >= 0.38) {
      patternLearningData[pattern].confidence_adjustment = -5;
    } else {
      patternLearningData[pattern].confidence_adjustment = -8;
    }
  }
  
  console.log(`📚 [Sun.win] Học: ${pattern} - Overall: ${patternLearningData[pattern].correct}/${patternLearningData[pattern].total} (${(accuracy * 100).toFixed(1)}%) | Recent: ${(recentAccuracy * 100).toFixed(1)}% | Adj: ${patternLearningData[pattern].confidence_adjustment > 0 ? '+' : ''}${patternLearningData[pattern].confidence_adjustment}%`);
  
  if (patternLearningData[pattern].total % 5 === 0) {
    saveLearningData();
  }
}

function applyLearningAdjustment(pattern, baseConfidence) {
  if (patternLearningData[pattern] && patternLearningData[pattern].total >= 3) {
    const adjusted = baseConfidence + patternLearningData[pattern].confidence_adjustment;
    return Math.max(55, Math.min(85, adjusted));
  }
  return Math.max(55, Math.min(85, baseConfidence));
}

// ============ THUẬT TOÁN SUN.WIN ============

// 1. CẦU BẾT - Kết quả liên tiếp cùng cửa
function analyzeCauBet(history) {
  if (history.length < 3) return null;
  
  let consecutiveCount = 1;
  let lastResult = history[0].ket_qua;
  
  for (let i = 1; i < Math.min(history.length, 20); i++) {
    if (history[i].ket_qua === lastResult) {
      consecutiveCount++;
    } else {
      break;
    }
  }
  
  if (consecutiveCount >= 3) {
    let baseConfidence;
    let prediction;
    
    if (consecutiveCount >= 6) {
      prediction = lastResult === 'Tài' ? 'Xỉu' : 'Tài';
      baseConfidence = Math.min(62 + (consecutiveCount - 6) * 2, 72);
    } else {
      prediction = lastResult;
      baseConfidence = 56 + consecutiveCount;
    }
    
    return {
      pattern: 'cau_bet',
      count: consecutiveCount,
      prediction: prediction,
      confidence: applyLearningAdjustment('cau_bet', baseConfidence),
      description: `Cầu bệt ${consecutiveCount} phiên liên tiếp ${lastResult}`
    };
  }
  
  return null;
}

// 2. CẦU ĐẢO 1-1 - Xen kẽ Tài Xỉu
function analyzeCauDao11(history) {
  if (history.length < 3) return null;
  
  const recent = history.slice(0, 10);
  let consecutiveDao = 0;
  
  for (let i = 0; i < recent.length - 1; i++) {
    if (recent[i].ket_qua !== recent[i + 1].ket_qua) {
      consecutiveDao++;
    } else {
      break;
    }
  }
  
  if (consecutiveDao >= 3) {
    const nextPrediction = recent[0].ket_qua === 'Tài' ? 'Xỉu' : 'Tài';
    const baseConfidence = 58 + Math.min(consecutiveDao - 3, 5) * 2;
    
    return {
      pattern: 'cau_dao_1_1',
      prediction: nextPrediction,
      confidence: applyLearningAdjustment('cau_dao_1_1', baseConfidence),
      description: `Cầu đảo 1-1 xuất hiện ${consecutiveDao} lần`
    };
  }
  
  return null;
}

// 3. CẦU 1-2-3 - Pattern tăng dần
function analyzeCau123(history) {
  if (history.length < 6) return null;
  
  const recent = history.slice(0, 6);
  
  if (recent[0].ket_qua === recent[1].ket_qua && 
      recent[0].ket_qua !== recent[2].ket_qua &&
      recent[2].ket_qua === recent[3].ket_qua &&
      recent[2].ket_qua === recent[4].ket_qua &&
      recent[2].ket_qua !== recent[5].ket_qua) {
    
    const prediction = recent[2].ket_qua;
    
    return {
      pattern: 'cau_1_2_3',
      prediction: prediction,
      confidence: applyLearningAdjustment('cau_1_2_3', 63),
      description: 'Cầu 1-2-3 đang hoạt động'
    };
  }
  
  return null;
}

// 4. CẦU 3-2-1 - Pattern giảm dần
function analyzeCau321(history) {
  if (history.length < 6) return null;
  
  const recent = history.slice(0, 6);
  
  if (recent[0].ket_qua === recent[1].ket_qua && 
      recent[0].ket_qua === recent[2].ket_qua &&
      recent[0].ket_qua !== recent[3].ket_qua &&
      recent[3].ket_qua === recent[4].ket_qua &&
      recent[3].ket_qua !== recent[5].ket_qua) {
    
    const prediction = recent[5].ket_qua === 'Tài' ? 'Xỉu' : 'Tài';
    
    return {
      pattern: 'cau_3_2_1',
      prediction: prediction,
      confidence: applyLearningAdjustment('cau_3_2_1', 62),
      description: 'Cầu 3-2-1 đang xuất hiện'
    };
  }
  
  return null;
}

// 5. NHỊP NGHIÊNG 5 - 4/5 phiên cùng kết quả
function analyzeCauNghieng5(history) {
  if (history.length < 5) return null;
  
  const recent5 = history.slice(0, 5);
  let taiCount = 0;
  let xiuCount = 0;
  
  recent5.forEach(item => {
    if (item.ket_qua === 'Tài') taiCount++;
    else xiuCount++;
  });
  
  if (taiCount === 4 && xiuCount === 1) {
    return {
      pattern: 'nhip_nghieng_5',
      prediction: 'Tài',
      confidence: applyLearningAdjustment('nhip_nghieng_5', 61),
      description: 'Nhịp nghiêng 5: 4/5 phiên Tài'
    };
  } else if (xiuCount === 4 && taiCount === 1) {
    return {
      pattern: 'nhip_nghieng_5',
      prediction: 'Xỉu',
      confidence: applyLearningAdjustment('nhip_nghieng_5', 61),
      description: 'Nhịp nghiêng 5: 4/5 phiên Xỉu'
    };
  }
  
  return null;
}

// 6. NHỊP NGHIÊNG 7 - 5/7 hoặc 6/7 phiên cùng kết quả
function analyzeCauNghieng7(history) {
  if (history.length < 7) return null;
  
  const recent7 = history.slice(0, 7);
  let taiCount = 0;
  let xiuCount = 0;
  
  recent7.forEach(item => {
    if (item.ket_qua === 'Tài') taiCount++;
    else xiuCount++;
  });
  
  if (taiCount >= 5) {
    return {
      pattern: 'nhip_nghieng_7',
      prediction: 'Tài',
      confidence: applyLearningAdjustment('nhip_nghieng_7', 64 + (taiCount - 5) * 2),
      description: `Nhịp nghiêng 7: ${taiCount}/7 phiên Tài`
    };
  } else if (xiuCount >= 5) {
    return {
      pattern: 'nhip_nghieng_7',
      prediction: 'Xỉu',
      confidence: applyLearningAdjustment('nhip_nghieng_7', 64 + (xiuCount - 5) * 2),
      description: `Nhịp nghiêng 7: ${xiuCount}/7 phiên Xỉu`
    };
  }
  
  return null;
}

// 7. PHÂN TÍCH TỔNG ĐIỂM
function analyzePhanTichTong(history) {
  if (history.length < 5) return null;
  
  const recent5 = history.slice(0, 5);
  const totals = recent5.map(item => parseInt(item.tong)).filter(t => !isNaN(t));
  
  if (totals.length !== 5) return null;
  
  const avgTotal = totals.reduce((a, b) => a + b, 0) / totals.length;
  
  if (avgTotal >= 12) {
    return {
      pattern: 'phan_tich_tong',
      prediction: 'Tài',
      confidence: applyLearningAdjustment('phan_tich_tong', 59),
      description: `Trung bình tổng điểm: ${avgTotal.toFixed(1)}`
    };
  } else if (avgTotal <= 9) {
    return {
      pattern: 'phan_tich_tong',
      prediction: 'Xỉu',
      confidence: applyLearningAdjustment('phan_tich_tong', 59),
      description: `Trung bình tổng điểm: ${avgTotal.toFixed(1)}`
    };
  }
  
  return null;
}

// 8. XU HƯỚNG MẠNH 15 VÁN
function analyzeXuHuongManh(history) {
  if (history.length < 15) return null;
  
  const recent15 = history.slice(0, 15);
  let taiCount = 0;
  let xiuCount = 0;
  
  recent15.forEach(item => {
    if (item.ket_qua === 'Tài') taiCount++;
    else xiuCount++;
  });
  
  if (taiCount >= 11) {
    return {
      pattern: 'xu_huong_manh',
      prediction: 'Tài',
      confidence: applyLearningAdjustment('xu_huong_manh', 66 + (taiCount - 11) * 2),
      description: `Xu hướng mạnh: ${taiCount}/15 phiên Tài`
    };
  } else if (xiuCount >= 11) {
    return {
      pattern: 'xu_huong_manh',
      prediction: 'Xỉu',
      confidence: applyLearningAdjustment('xu_huong_manh', 66 + (xiuCount - 11) * 2),
      description: `Xu hướng mạnh: ${xiuCount}/15 phiên Xỉu`
    };
  }
  
  return null;
}

// 9. CẦU NHẢY/LUNG TUNG
function analyzeCauNhay(history) {
  if (history.length < 10) return null;
  
  const recent10 = history.slice(0, 10);
  let changes = 0;
  
  for (let i = 0; i < recent10.length - 1; i++) {
    if (recent10[i].ket_qua !== recent10[i + 1].ket_qua) {
      changes++;
    }
  }
  
  if (changes >= 7) {
    const lastResult = recent10[0].ket_qua;
    const prediction = lastResult === 'Tài' ? 'Xỉu' : 'Tài';
    
    return {
      pattern: 'cau_nhay',
      prediction: prediction,
      confidence: applyLearningAdjustment('cau_nhay', 58),
      description: `Cầu nhảy: ${changes}/9 lần đổi kết quả`
    };
  }
  
  return null;
}

// 10. GẤP THẾP PROGRESSIVE (MARTINGALE)
function analyzeGapThepMartingale(history) {
  if (history.length < 5) return null;
  
  let consecutiveCount = 1;
  let lastResult = history[0].ket_qua;
  
  for (let i = 1; i < Math.min(history.length, 15); i++) {
    if (history[i].ket_qua === lastResult) {
      consecutiveCount++;
    } else {
      break;
    }
  }
  
  if (consecutiveCount >= 2) {
    const baseConfidence = Math.min(57 + (consecutiveCount - 2) * 2, 70);
    
    return {
      pattern: 'gap_thep_martingale',
      prediction: lastResult,
      confidence: applyLearningAdjustment('gap_thep_martingale', baseConfidence),
      description: `Gấp thếp: ${consecutiveCount} phiên liên tiếp ${lastResult}, tiếp tục cùng cửa`
    };
  }
  
  return null;
}

// 11. FIBONACCI PATTERN
function analyzeFibonacci(history) {
  if (history.length < 10) return null;
  
  const recent = history.slice(0, 10);
  const taiPositions = [];
  const xiuPositions = [];
  
  recent.forEach((item, idx) => {
    if (item.ket_qua === 'Tài') taiPositions.push(idx);
    else xiuPositions.push(idx);
  });
  
  const checkFib = (positions) => {
    if (positions.length < 3) return false;
    const gaps = [];
    for (let i = 1; i < positions.length; i++) {
      gaps.push(positions[i] - positions[i-1]);
    }
    return gaps.length >= 2 && Math.abs(gaps[gaps.length-1] - gaps[gaps.length-2]) <= 2;
  };
  
  if (checkFib(taiPositions)) {
    return {
      pattern: 'fibonacci',
      prediction: 'Tài',
      confidence: applyLearningAdjustment('fibonacci', 60),
      description: 'Fibonacci pattern phát hiện cho Tài'
    };
  }
  
  if (checkFib(xiuPositions)) {
    return {
      pattern: 'fibonacci',
      prediction: 'Xỉu',
      confidence: applyLearningAdjustment('fibonacci', 60),
      description: 'Fibonacci pattern phát hiện cho Xỉu'
    };
  }
  
  return null;
}

// 12. CẦU 2-2 - Pattern 2 phiên liên tiếp rồi đổi
function analyzeCau22(history) {
  if (history.length < 6) return null;
  
  const recent = history.slice(0, 6);
  
  if (recent[0].ket_qua === recent[1].ket_qua && 
      recent[0].ket_qua !== recent[2].ket_qua &&
      recent[2].ket_qua === recent[3].ket_qua &&
      recent[0].ket_qua === recent[4].ket_qua &&
      recent[0].ket_qua === recent[5].ket_qua) {
    
    const prediction = recent[0].ket_qua === 'Tài' ? 'Xỉu' : 'Tài';
    
    return {
      pattern: 'cau_2_2',
      prediction: prediction,
      confidence: applyLearningAdjustment('cau_2_2', 65),
      description: 'Cầu 2-2 đang hoạt động mạnh'
    };
  }
  
  if (recent[0].ket_qua === recent[1].ket_qua && 
      recent[0].ket_qua !== recent[2].ket_qua &&
      recent[2].ket_qua === recent[3].ket_qua) {
    
    const prediction = recent[2].ket_qua === 'Tài' ? 'Xỉu' : 'Tài';
    
    return {
      pattern: 'cau_2_2',
      prediction: prediction,
      confidence: applyLearningAdjustment('cau_2_2', 62),
      description: 'Cầu 2-2 đang hình thành'
    };
  }
  
  return null;
}

// 13. CẦU 2-1-2 - Pattern phức tạp
function analyzeCau212(history) {
  if (history.length < 5) return null;
  
  const recent = history.slice(0, 5);
  
  if (recent[0].ket_qua === recent[1].ket_qua && 
      recent[0].ket_qua !== recent[2].ket_qua &&
      recent[2].ket_qua !== recent[3].ket_qua &&
      recent[3].ket_qua === recent[4].ket_qua) {
    
    if (recent[0].ket_qua === recent[3].ket_qua) {
      const prediction = recent[0].ket_qua === 'Tài' ? 'Xỉu' : 'Tài';
      
      return {
        pattern: 'cau_2_1_2',
        prediction: prediction,
        confidence: applyLearningAdjustment('cau_2_1_2', 64),
        description: 'Cầu 2-1-2 xuất hiện rõ ràng'
      };
    }
  }
  
  return null;
}

// 14. PHÂN TÍCH XÚC XẮC ĐƠN LẺ - Nhận diện theo số xúc xắc
function analyzePhanTichXucXac(history) {
  if (history.length < 10) return null;
  
  const recent10 = history.slice(0, 10);
  let tongXucXacChan = 0;
  let tongXucXacLe = 0;
  
  recent10.forEach(item => {
    const x1 = parseInt(item.xuc_xac_1);
    const x2 = parseInt(item.xuc_xac_2);
    const x3 = parseInt(item.xuc_xac_3);
    
    if (!isNaN(x1) && !isNaN(x2) && !isNaN(x3)) {
      const chanCount = [x1, x2, x3].filter(x => x % 2 === 0).length;
      if (chanCount >= 2) tongXucXacChan++;
      else tongXucXacLe++;
    }
  });
  
  if (tongXucXacChan >= 7) {
    return {
      pattern: 'phan_tich_xuc_xac',
      prediction: 'Tài',
      confidence: applyLearningAdjustment('phan_tich_xuc_xac', 58),
      description: `Xu hướng xúc xắc chẵn: ${tongXucXacChan}/10 phiên`
    };
  } else if (tongXucXacLe >= 7) {
    return {
      pattern: 'phan_tich_xuc_xac',
      prediction: 'Xỉu',
      confidence: applyLearningAdjustment('phan_tich_xuc_xac', 58),
      description: `Xu hướng xúc xắc lẻ: ${tongXucXacLe}/10 phiên`
    };
  }
  
  return null;
}

// 15. PHÂN TÍCH LẺ CHẴN TỔNG ĐIỂM
function analyzeOddEven(history) {
  if (history.length < 8) return null;
  
  const recent8 = history.slice(0, 8);
  let chanCount = 0;
  let leCount = 0;
  
  recent8.forEach(item => {
    const total = parseInt(item.tong);
    if (!isNaN(total)) {
      if (total % 2 === 0) chanCount++;
      else leCount++;
    }
  });
  
  if (chanCount >= 6) {
    return {
      pattern: 'odd_even_analysis',
      prediction: 'Tài',
      confidence: applyLearningAdjustment('odd_even_analysis', 59),
      description: `Tổng chẵn chiếm ưu thế: ${chanCount}/8 phiên`
    };
  } else if (leCount >= 6) {
    return {
      pattern: 'odd_even_analysis',
      prediction: 'Xỉu',
      confidence: applyLearningAdjustment('odd_even_analysis', 59),
      description: `Tổng lẻ chiếm ưu thế: ${leCount}/8 phiên`
    };
  }
  
  return null;
}

// 16. PHÂN TÍCH XU HƯỚNG TỔNG ĐIỂM TĂNG GIẢM
function analyzeTotalSumTrend(history) {
  if (history.length < 6) return null;
  
  const recent6 = history.slice(0, 6);
  const totals = recent6.map(item => parseInt(item.tong)).filter(t => !isNaN(t));
  
  if (totals.length !== 6) return null;
  
  let increasing = 0;
  let decreasing = 0;
  
  for (let i = 1; i < totals.length; i++) {
    if (totals[i] > totals[i-1]) increasing++;
    if (totals[i] < totals[i-1]) decreasing++;
  }
  
  if (increasing >= 4) {
    return {
      pattern: 'total_sum_trend',
      prediction: 'Tài',
      confidence: applyLearningAdjustment('total_sum_trend', 61),
      description: `Xu hướng tổng điểm tăng: ${increasing}/5 lần`
    };
  } else if (decreasing >= 4) {
    return {
      pattern: 'total_sum_trend',
      prediction: 'Xỉu',
      confidence: applyLearningAdjustment('total_sum_trend', 61),
      description: `Xu hướng tổng điểm giảm: ${decreasing}/5 lần`
    };
  }
  
  return null;
}

// 17. AI PHÁT HIỆN CAN THIỆP NHÀ CÁI - Thông minh như con người
function detectHouseIntervention(history, predictionHistory) {
  if (history.length < 20 || predictionHistory.length < 10) return null;
  
  const recent20 = history.slice(0, 20);
  const recentPredictions = predictionHistory.filter(p => p.kq_du_doan !== 'dang_doi').slice(0, 10);
  
  let suspiciousScore = 0;
  const signals = [];
  
  const recent5 = recent20.slice(0, 5);
  const extendedStreaks = recent20.filter((item, idx, arr) => {
    if (idx === 0) return false;
    let streak = 1;
    for (let i = idx - 1; i >= 0 && i >= idx - 10; i--) {
      if (arr[i].ket_qua === item.ket_qua) streak++;
      else break;
    }
    return streak >= 8;
  });
  
  if (extendedStreaks.length > 0) {
    suspiciousScore += 30;
    signals.push('Chuỗi bất thường dài (8+ phiên) - Nghi ngờ can thiệp');
  }
  
  const totals = recent20.map(item => parseInt(item.tong)).filter(t => !isNaN(t));
  const extremeTotals = totals.filter(t => t <= 4 || t >= 17);
  if (extremeTotals.length >= 5) {
    suspiciousScore += 25;
    signals.push(`Tổng điểm cực đoan xuất hiện ${extremeTotals.length}/20 lần`);
  }
  
  if (recentPredictions.length >= 8) {
    const wrongPredictions = recentPredictions.filter(p => p.kq_du_doan === 'sai');
    const wrongRate = (wrongPredictions.length / recentPredictions.length) * 100;
    
    if (wrongRate >= 70) {
      suspiciousScore += 35;
      signals.push(`Tỷ lệ sai cao bất thường: ${wrongRate.toFixed(0)}%`);
    }
  }
  
  const recent10Results = recent20.slice(0, 10);
  let taiCount = recent10Results.filter(r => r.ket_qua === 'Tài').length;
  let xiuCount = 10 - taiCount;
  
  if (taiCount >= 9 || xiuCount >= 9) {
    suspiciousScore += 20;
    signals.push('Mất cân bằng nghiêm trọng 10 ván gần');
  }
  
  if (suspiciousScore >= 50) {
    const oppositePredict = recent5[0].ket_qua === 'Tài' ? 'Xỉu' : 'Tài';
    
    return {
      pattern: 'house_intervention',
      prediction: oppositePredict,
      confidence: applyLearningAdjustment('house_intervention', Math.min(58 + suspiciousScore / 8, 72)),
      description: `AI phát hiện can thiệp nhà cái - Điểm nghi ngờ: ${suspiciousScore}/100`,
      intervention_signals: signals
    };
  }
  
  return null;
}

// ============ FETCH LỊCH SỬ TỪ API SUN.WIN ============
async function fetchHistory() {
  const now = Date.now();
  if (historyCache.data.length > 0 && (now - historyCache.timestamp) < CACHE_TTL) {
    return historyCache.data;
  }
  
  try {
    const response = await axios.get('https://sunwinsaygex-ew87.onrender.com/api/taixiu/history', {
      timeout: 5000
    });
    
    if (Array.isArray(response.data)) {
      historyCache.data = response.data.slice(0, MAX_HISTORY);
      historyCache.timestamp = now;
      return historyCache.data;
    }
    
    return [];
  } catch (error) {
    console.error('❌ [Sun.win] Lỗi khi fetch history:', error.message);
    return historyCache.data || [];
  }
}

// ============ DỰ ĐOÁN TỔNG HỢP ============
async function generatePrediction() {
  try {
    const history = await fetchHistory();
    
    if (history.length === 0) {
      console.log('⚠️ [Sun.win] Không có lịch sử');
      return null;
    }
    
    const currentPhien = history[0].phien;
    
    if (currentPhien === lastProcessedPhien) {
      return currentPrediction;
    }
    
    const houseDetect = detectHouseIntervention(history, predictionHistory);
    
    const algorithms = [
      analyzeCauBet,
      analyzeCauDao11,
      analyzeCau123,
      analyzeCau321,
      analyzeCau22,
      analyzeCau212,
      analyzeCauNghieng5,
      analyzeCauNghieng7,
      analyzePhanTichTong,
      analyzePhanTichXucXac,
      analyzeXuHuongManh,
      analyzeCauNhay,
      analyzeGapThepMartingale,
      analyzeFibonacci,
      analyzeOddEven,
      analyzeTotalSumTrend
    ];
    
    const predictions = [];
    
    for (const algo of algorithms) {
      const result = algo(history);
      if (result) {
        predictions.push(result);
      }
    }
    
    if (houseDetect) {
      predictions.push(houseDetect);
    }
    
    if (predictions.length === 0) {
      console.log('⚠️ [Sun.win] Không tìm thấy pattern nào');
      return null;
    }
    
    predictions.sort((a, b) => b.confidence - a.confidence);
    
    const bestPrediction = predictions[0];
    
    const taiVotes = predictions.filter(p => p.prediction === 'Tài').length;
    const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu').length;
    
    let finalPrediction = bestPrediction.prediction;
    let finalConfidence = bestPrediction.confidence;
    
    if (predictions.length >= 3) {
      if (taiVotes > xiuVotes * 2) {
        finalPrediction = 'Tài';
        finalConfidence = Math.min(finalConfidence + 2, 85);
      } else if (xiuVotes > taiVotes * 2) {
        finalPrediction = 'Xỉu';
        finalConfidence = Math.min(finalConfidence + 2, 85);
      }
    }
    
    finalConfidence = Math.max(55, Math.min(85, finalConfidence));
    
    const nextPhien = currentPhien + 1;
    
    const breakDetect = detectBreakPattern(history, predictionHistory);
    
    const newPrediction = {
      game: 'Sun.win',
      phien: nextPhien.toString(),
      du_doan: finalPrediction,
      ti_le_thang: finalConfidence.toFixed(0) + '%',
      thuat_toan: bestPrediction.pattern,
      mo_ta: bestPrediction.description,
      so_pattern_phat_hien: predictions.length,
      tai_votes: taiVotes,
      xiu_votes: xiuVotes,
      top_patterns: predictions.slice(0, 5).map(p => ({
        pattern: p.pattern,
        prediction: p.prediction,
        confidence: p.confidence.toFixed(0) + '%',
        description: p.description
      })),
      break_detection: {
        risk_level: breakDetect.risk_level,
        break_probability: breakDetect.break_probability + '%',
        recommendation: breakDetect.recommendation,
        signals: breakDetect.suspicious_signals
      },
      house_intervention: houseDetect ? {
        detected: true,
        confidence: houseDetect.confidence.toFixed(0) + '%',
        signals: houseDetect.intervention_signals
      } : { detected: false },
      kq_du_doan: 'dang_doi',
      ket_qua: 'dang_doi',
      xuc_xac_1: 'dang_doi',
      xuc_xac_2: 'dang_doi',
      xuc_xac_3: 'dang_doi',
      tong: 'dang_doi',
      timestamp: new Date().toISOString()
    };
    
    currentPrediction = newPrediction;
    predictionHistory.unshift(newPrediction);
    
    if (predictionHistory.length > MAX_HISTORY) {
      predictionHistory = predictionHistory.slice(0, MAX_HISTORY);
    }
    
    lastProcessedPhien = currentPhien;
    
    console.log(`\n🎲 [Sun.win] Dự đoán phiên #${nextPhien}: ${finalPrediction} (${finalConfidence.toFixed(0)}%) - ${bestPrediction.pattern}`);
    console.log(`   📊 Patterns: ${predictions.length} | Tài: ${taiVotes} | Xỉu: ${xiuVotes}`);
    console.log(`   ${breakDetect.recommendation}`);
    if (houseDetect) {
      console.log(`   🚨 AI phát hiện can thiệp nhà cái - Confidence: ${houseDetect.confidence.toFixed(0)}%`);
    }
    
    return newPrediction;
  } catch (error) {
    console.error('❌ [Sun.win] Lỗi khi tạo dự đoán:', error.message);
    return null;
  }
}

// ============ CẬP NHẬT KẾT QUẢ & HỌC TẬP ============
async function updateResults() {
  try {
    const history = await fetchHistory();
    
    if (history.length === 0) return;
    
    const latestResult = history[0];
    
    for (let prediction of predictionHistory) {
      if (prediction.phien === latestResult.phien.toString() && 
          prediction.kq_du_doan === 'dang_doi') {
        
        prediction.ket_qua = latestResult.ket_qua;
        prediction.xuc_xac_1 = latestResult.xuc_xac_1.toString();
        prediction.xuc_xac_2 = latestResult.xuc_xac_2.toString();
        prediction.xuc_xac_3 = latestResult.xuc_xac_3.toString();
        prediction.tong = latestResult.tong.toString();
        
        const isCorrect = prediction.du_doan === latestResult.ket_qua;
        prediction.kq_du_doan = isCorrect ? 'dung' : 'sai';
        
        updatePatternLearning(prediction.thuat_toan, isCorrect);
        
        if (isCorrect) {
          breakDetectionData.consecutiveWrong = 0;
          console.log(`✅ [Sun.win] Phiên #${prediction.phien}: ĐÚNG - ${prediction.du_doan} (${latestResult.xuc_xac_1}-${latestResult.xuc_xac_2}-${latestResult.xuc_xac_3} = ${latestResult.tong})`);
        } else {
          breakDetectionData.consecutiveWrong++;
          console.log(`❌ [Sun.win] Phiên #${prediction.phien}: SAI - Dự đoán ${prediction.du_doan}, thực tế ${latestResult.ket_qua} (${latestResult.xuc_xac_1}-${latestResult.xuc_xac_2}-${latestResult.xuc_xac_3} = ${latestResult.tong})`);
        }
        
        break;
      }
    }
  } catch (error) {
    console.error('❌ [Sun.win] Lỗi khi update kết quả:', error.message);
  }
}

// ============ VÒNG LẶP CHÍNH ============
async function startPredictionLoop() {
  console.log('🚀 [Sun.win] Bot dự đoán đã khởi động...\n');
  
  while (true) {
    try {
      await updateResults();
      
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
      
      await generatePrediction();
      
      await new Promise(resolve => setTimeout(resolve, WAIT_AFTER_RESULT));
    } catch (error) {
      console.error('❌ [Sun.win] Lỗi trong vòng lặp:', error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// ============ PHÁT HIỆN BẺ CẦU NÂNG CAO - THÔNG MINH NHƯ CON NGƯỜI ============
function detectBreakPattern(history, predictions) {
  const suspiciousSignals = [];
  let breakProbability = 0;
  
  if (breakDetectionData.consecutiveWrong >= 5) {
    suspiciousSignals.push(`⚠️ ${breakDetectionData.consecutiveWrong} lần sai liên tiếp - Nhà cái đang kiểm soát`);
    breakProbability += 30;
  }
  
  if (breakDetectionData.consecutiveWrong >= 3) {
    breakProbability += 18;
  }
  
  const recent10 = predictions.filter(p => p.kq_du_doan !== 'dang_doi').slice(0, 10);
  if (recent10.length >= 10) {
    const correctCount = recent10.filter(p => p.kq_du_doan === 'dung').length;
    const accuracy = (correctCount / 10) * 100;
    
    if (accuracy < 35) {
      suspiciousSignals.push(`🔴 Độ chính xác 10 ván: ${accuracy.toFixed(0)}% - Cực kỳ thấp`);
      breakProbability += 25;
    } else if (accuracy < 50) {
      suspiciousSignals.push(`⚠️ Độ chính xác 10 ván: ${accuracy.toFixed(0)}% - Dưới mức bình thường`);
      breakProbability += 15;
    }
  }
  
  if (history.length >= 5) {
    const recent5 = history.slice(0, 5);
    const allSame = recent5.every(r => r.ket_qua === recent5[0].ket_qua);
    if (allSame) {
      suspiciousSignals.push('🔴 5 phiên liên tiếp cùng kết quả - Bất thường cao');
      breakProbability += 18;
    }
  }
  
  if (history.length >= 8) {
    const recent8 = history.slice(0, 8);
    let taiCount = recent8.filter(r => r.ket_qua === 'Tài').length;
    let xiuCount = 8 - taiCount;
    
    if (taiCount >= 7 || xiuCount >= 7) {
      suspiciousSignals.push('⚠️ Mất cân bằng nghiêm trọng 8 phiên gần');
      breakProbability += 12;
    }
  }
  
  if (history.length >= 15) {
    const recent15 = history.slice(0, 15);
    const totals = recent15.map(h => parseInt(h.tong)).filter(t => !isNaN(t));
    const extremes = totals.filter(t => t <= 4 || t >= 17);
    
    if (extremes.length >= 4) {
      suspiciousSignals.push(`🔴 Xuất hiện ${extremes.length} tổng điểm cực đoan trong 15 ván`);
      breakProbability += 20;
    }
  }
  
  const recent20Preds = predictions.filter(p => p.kq_du_doan !== 'dang_doi').slice(0, 20);
  if (recent20Preds.length >= 15) {
    const highConfWrong = recent20Preds.filter(p => {
      const conf = parseInt(p.ti_le_thang);
      return !isNaN(conf) && conf >= 75 && p.kq_du_doan === 'sai';
    });
    
    if (highConfWrong.length >= 5) {
      suspiciousSignals.push(`⚠️ ${highConfWrong.length} dự đoán độ tin cậy cao bị sai - Nghi ngờ can thiệp`);
      breakProbability += 22;
    }
  }
  
  let riskLevel = 'low';
  let recommendation = '';
  
  if (breakProbability >= 65) {
    riskLevel = 'critical';
    recommendation = '🛑 CỰC KỲ NGUY HIỂM - DỪNG NGAY LẬP TỨC';
  } else if (breakProbability >= 50) {
    riskLevel = 'high';
    recommendation = '⛔ NGUY HIỂM - Nên tạm dừng chơi hoặc giảm cược tối thiểu';
  } else if (breakProbability >= 35) {
    riskLevel = 'medium';
    recommendation = '⚠️ CẢNH BÁO - Giảm mức cược xuống 50%';
  } else if (breakProbability >= 20) {
    riskLevel = 'low_warning';
    recommendation = '⚡ CHÚ Ý - Theo dõi sát, chơi thận trọng';
  } else {
    riskLevel = 'safe';
    recommendation = '✅ AN TOÀN - Có thể tiếp tục bình thường';
  }
  
  breakDetectionData.riskLevel = riskLevel;
  breakDetectionData.suspiciousPatterns = suspiciousSignals;
  
  return {
    risk_level: riskLevel,
    break_probability: Math.min(breakProbability, 98),
    suspicious_signals: suspiciousSignals,
    recommendation: recommendation,
    should_stop: breakProbability >= 65
  };
}

// ============ API ENDPOINTS ============
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.get('/api/sunwin/prediction', (req, res) => {
  if (!currentPrediction) {
    return res.json({
      game: 'Sun.win',
      phien: '0',
      du_doan: 'dang_doi',
      ti_le_thang: '0%',
      kq_du_doan: 'dang_doi',
      ket_qua: 'dang_doi',
      xuc_xac_1: 'dang_doi',
      xuc_xac_2: 'dang_doi',
      xuc_xac_3: 'dang_doi',
      tong: 'dang_doi'
    });
  }
  
  res.json(currentPrediction);
});

app.get('/api/sunwin/history', async (req, res) => {
  try {
    const history = await fetchHistory();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Không thể lấy lịch sử Sun.win' });
  }
});

app.get('/api/sunwin/prediction-history', (req, res) => {
  res.json(predictionHistory);
});

app.get('/api/sunwin/stats', async (req, res) => {
  try {
    const history = await fetchHistory();
    
    if (history.length === 0) {
      return res.json({ error: 'Không có lịch sử' });
    }

    const last20 = history.slice(0, 20);
    let taiCount = 0;
    let xiuCount = 0;
    
    last20.forEach(item => {
      if (item.ket_qua === 'Tài') taiCount++;
      else xiuCount++;
    });

    let correctPredictions = 0;
    let totalPredictions = predictionHistory.filter(p => p.kq_du_doan !== 'dang_doi').length;
    
    predictionHistory.forEach(p => {
      if (p.kq_du_doan === 'dung') correctPredictions++;
    });

    const patternStats = {};
    predictionHistory.forEach(p => {
      if (p.kq_du_doan !== 'dang_doi') {
        if (!patternStats[p.thuat_toan]) {
          patternStats[p.thuat_toan] = { total: 0, correct: 0 };
        }
        patternStats[p.thuat_toan].total++;
        if (p.kq_du_doan === 'dung') {
          patternStats[p.thuat_toan].correct++;
        }
      }
    });

    res.json({
      game: 'Sun.win',
      last20Sessions: {
        tai: taiCount,
        xiu: xiuCount,
        total: last20.length
      },
      predictionStats: {
        total: totalPredictions,
        correct: correctPredictions,
        wrong: totalPredictions - correctPredictions,
        accuracy: totalPredictions > 0 ? ((correctPredictions / totalPredictions) * 100).toFixed(1) + '%' : '0%'
      },
      patternPerformance: patternStats,
      latestSession: history[0],
      currentPrediction: currentPrediction
    });
  } catch (error) {
    res.status(500).json({ error: 'Không thể lấy thống kê Sun.win' });
  }
});

app.get('/api/sunwin/learning', (req, res) => {
  const learningStats = {};
  
  Object.keys(patternLearningData).forEach(pattern => {
    const data = patternLearningData[pattern];
    learningStats[pattern] = {
      total: data.total,
      correct: data.correct,
      accuracy: data.total > 0 ? ((data.correct / data.total) * 100).toFixed(1) + '%' : '0%',
      confidence_adjustment: data.confidence_adjustment
    };
  });
  
  res.json({
    game: 'Sun.win',
    learning_data: learningStats,
    total_learning_sessions: Object.values(patternLearningData).reduce((sum, p) => sum + p.total, 0)
  });
});

app.get('/api/sunwin/break-detection', async (req, res) => {
  try {
    const history = await fetchHistory();
    
    if (history.length === 0 || predictionHistory.length === 0) {
      return res.json({ 
        game: 'Sun.win',
        error: 'Chưa đủ dữ liệu',
        risk_level: 'unknown' 
      });
    }
    
    const detection = detectBreakPattern(history, predictionHistory);
    
    res.json({
      game: 'Sun.win',
      message: 'Hệ thống phát hiện nhà cái bẻ cầu - Sun.win',
      current_status: {
        risk_level: detection.risk_level,
        break_probability: detection.break_probability + '%',
        consecutive_wrong: breakDetectionData.consecutiveWrong,
        recommendation: detection.recommendation
      },
      analysis: {
        suspicious_signals: detection.suspicious_signals,
        total_signals: detection.suspicious_signals.length
      },
      advice: {
        should_continue: detection.break_probability < 60,
        suggested_action: detection.break_probability >= 60 
          ? '⚠️ Tạm dừng hoặc giảm cược xuống tối thiểu' 
          : '✅ An toàn, có thể tiếp tục',
        reason: detection.suspicious_signals.length > 0 
          ? detection.suspicious_signals.join(', ') 
          : 'Không phát hiện tín hiệu bất thường'
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Không thể phân tích break pattern Sun.win' });
  }
});

app.get('/', (req, res) => {
  res.json({
    message: '🎲 API Dự Đoán Tài Xỉu Sun.win - AI v2.0 NÂNG CẤP TOÀN DIỆN 🔥',
    version: '2.0',
    game: 'Sun.win',
    update: 'Nâng cấp toàn diện - AI tự học thông minh như con người',
    algorithms: [
      '1. Cầu Bệt (Liên tiếp cùng kết quả)',
      '2. Cầu Đảo 1-1 (Xen kẽ Tài-Xỉu)',
      '3. Cầu 1-2-3 (Pattern tăng dần)',
      '4. Cầu 3-2-1 (Pattern giảm dần)',
      '5. Cầu 2-2 (2 phiên đổi kết quả) ⭐ MỚI',
      '6. Cầu 2-1-2 (Pattern phức tạp) ⭐ MỚI',
      '7. Nhịp Nghiêng 5 (4/5 phiên)',
      '8. Nhịp Nghiêng 7 (5-6/7 phiên)',
      '9. Phân Tích Tổng Điểm',
      '10. Phân Tích Xúc Xắc Đơn Lẻ ⭐ MỚI',
      '11. Xu Hướng Mạnh 15 ván',
      '12. Cầu Nhảy/Lung Tung',
      '13. Gấp Thếp Progressive (Martingale)',
      '14. Fibonacci Pattern',
      '15. Phân Tích Chẵn Lẻ Tổng Điểm ⭐ MỚI',
      '16. Xu Hướng Tổng Điểm Tăng/Giảm ⭐ MỚI',
      '17. AI Phát Hiện Can Thiệp Nhà Cái 🤖 ⭐ MỚI',
      '18. Break Detection Nâng Cao 🧠 ⭐ NÂNG CẤP'
    ],
    endpoints: {
      prediction: '/api/sunwin/prediction - Dự đoán phiên hiện tại',
      history: '/api/sunwin/history - Lịch sử từ Sun.win API',
      predictionHistory: '/api/sunwin/prediction-history - Lịch sử dự đoán của bot',
      stats: '/api/sunwin/stats - Thống kê chi tiết',
      learning: '/api/sunwin/learning - Dữ liệu học tập',
      breakDetection: '/api/sunwin/break-detection - Phát hiện nhà cái bẻ cầu'
    },
    config: {
      max_history: '500 phiên',
      check_interval: '3 giây',
      wait_after_result: '5 giây',
      cache_ttl: '2 giây',
      total_algorithms: 17,
      learning_file: 'sunwin_learning_data.json'
    },
    new_features: {
      ai_house_detection: '🤖 AI phát hiện can thiệp nhà cái - Hiểu ý đồ như con người',
      advanced_break_detection: '🧠 Phát hiện bẻ cầu nâng cao - 5 cấp độ cảnh báo',
      smart_learning: '📚 Tự học thông minh - Tự điều chỉnh theo hiệu suất',
      new_patterns: '⭐ 6 thuật toán mới từ nghiên cứu Sun.win',
      dice_analysis: '🎲 Phân tích xúc xắc chi tiết - Chẵn/Lẻ/Xu hướng',
      confidence_boost: '💪 Độ tin cậy được tối ưu dựa trên học máy'
    },
    features: {
      break_detection: 'Phát hiện khi nào nhà cái sắp bẻ cầu (5 cấp độ)',
      house_intervention: 'AI phát hiện can thiệp nhà cái tự động',
      smart_learning: 'Tự học và cải thiện liên tục từ mọi kết quả',
      adaptive_confidence: 'Điều chỉnh độ tin cậy theo performance thực tế',
      pattern_analysis: '17 thuật toán phân tích cầu từ research chuyên sâu',
      multi_pattern_vote: 'Bỏ phiếu đa thuật toán cho dự đoán chính xác hơn'
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎲 Sun.win API đang chạy tại http://0.0.0.0:${PORT}`);
  console.log('📊 Endpoints:');
  console.log(`   - http://localhost:${PORT}/api/sunwin/prediction`);
  console.log(`   - http://localhost:${PORT}/api/sunwin/stats`);
  console.log(`   - http://localhost:${PORT}/api/sunwin/history\n`);
  
  startPredictionLoop();
});
