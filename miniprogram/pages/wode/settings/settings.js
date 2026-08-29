Page({
  // 邀请好友
  inviteFriends() {
    wx.showShareMenu({
      withShareTicket: true,
      success: function (res) {
        wx.showToast({
          title: '分享成功',
          icon: 'success'
        });
      },
      fail: function (res) {
        wx.showToast({
          title: '分享失败',
          icon: 'none'
        });
      }
    });
  },

  // 推送设置
  pushSettings() {
    wx.showModal({
      title: '推送设置',
      content: '是否开启微信服务通知？',
      success: function (res) {
        if (res.confirm) {
          wx.showToast({
            title: '已开启推送',
            icon: 'success'
          });
        } else if (res.cancel) {
          wx.showToast({
            title: '已关闭推送',
            icon: 'none'
          });
        }
      }
    });
  },

  // 建议反馈
  feedback() {
    wx.showModal({
      title: '建议反馈',
      content: '请输入您的反馈内容',
      editable: true,
      placeholderText: '请描述您遇到的问题或建议',
      success: function (res) {
        if (res.confirm && res.content) {
          wx.showToast({
            title: '感谢您的反馈',
            icon: 'success'
          });
        }
      }
    });
  },

  // 关于我们
  aboutUs() {
    wx.showModal({
      title: '关于我们',
      content: '同路人 - 旅行搭子小程序\n\n版本：1.0.0\n\n联系我们：support@tongluren.com',
      showCancel: false,
      confirmText: '确定'
    });
  },

  // 退出登录
  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: function (res) {
        if (res.confirm) {
          wx.showToast({
            title: '已退出登录',
            icon: 'success'
          });
          // 清除用户信息
          wx.removeStorageSync('userInfo');
          // 返回首页
          wx.switchTab({
            url: '/pages/home/home'
          });
        }
      }
    });
  },

  // 页面加载
  onLoad() {
    // 页面加载时的初始化
  },

  // 页面显示
  onShow() {
    // 页面显示时的处理
  },

  // 页面隐藏
  onHide() {
    // 页面隐藏时的处理
  },

  // 页面卸载
  onUnload() {
    // 页面卸载时的处理
  }
});