Page({
  data: {
    // 提示条显示状态
    showTips: true,
    // 上传的图片
    images: [],
    // 标题
    title: '',
    // 描述
    description: '',
    // 热门标签
    hotTags: ['二手', '旅行搭子', '青年票', '美食探店', '摄影约拍', '租房求租', '语言交换'],
    // 地点
    location: '',
    // 时间
    time: '',
    // 人数
    number: '',
    // 公开/私密选项显示
    showVisibilityOptions: false,
    // 可见性
    visibility: 'public',
    // 同步至小红书
    syncXHS: false,
    // 内容分类
    category: '',
    // 分类列表
    categoryList: ['搭子出行', '打听求助', '地陪跑腿', '二手交易', '其他'],
    // 显示分类弹窗
    showCategoryModal: false,
    // 发布小组（改为多选数组）
    selectedGroups: [],
    // 我的小组列表
    myGroups: ['伦敦徒步搭子', '巴黎华人互助', '柏林二手交易', '罗马美食分享', '东京华人圈', '纽约留学生', '悉尼华人社区', '新加坡互助群'],
    // 显示小组弹窗
    showGroupModal: false,
    // 是否可以发布
    canPublish: false
  },

  // 关闭提示条
  closeTips() {
    this.setData({
      showTips: false
    });
  },

  // 选择图片
  chooseImage() {
    wx.chooseImage({
      count: 9,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({
          images: [...this.data.images, ...res.tempFilePaths]
        });
        this.checkCanPublish();
      }
    });
  },

  // 标题输入
  onTitleInput(e) {
    this.setData({
      title: e.detail.value
    });
    this.checkCanPublish();
  },

  // 描述输入
  onDescInput(e) {
    this.setData({
      description: e.detail.value
    });
    this.checkCanPublish();
  },

  // 选择标签
  selectTag(e) {
    const tag = e.currentTarget.dataset.tag;
    const currentDesc = this.data.description;
    const newDesc = currentDesc ? `${currentDesc} #${tag} ` : `#${tag} `;
    this.setData({
      description: newDesc
    });
  },

  // 选择地点
  selectLocation() {
    wx.showToast({
      title: '选择地点',
      icon: 'none'
    });
  },

  // 选择时间
  selectTime() {
    wx.showToast({
      title: '选择时间',
      icon: 'none'
    });
  },

  // 选择人数
  selectNumber() {
    wx.showToast({
      title: '选择人数',
      icon: 'none'
    });
  },

  // 切换公开选项
  togglePublic() {
    this.setData({
      showVisibilityOptions: !this.data.showVisibilityOptions
    });
  },

  // 设置可见性
  setVisibility(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      visibility: type,
      showVisibilityOptions: false
    });
  },

  // 切换小红书同步
  toggleXHS() {
    this.setData({
      syncXHS: !this.data.syncXHS
    });
  },

  // 选择分类
  selectCategory() {
    this.setData({
      showCategoryModal: true
    });
  },

  // 关闭分类弹窗
  closeCategoryModal() {
    this.setData({
      showCategoryModal: false
    });
  },

  // 确认分类选择
  confirmCategory(e) {
    const category = e.currentTarget.dataset.category;
    this.setData({
      category: category,
      showCategoryModal: false
    });
    this.checkCanPublish();
  },

  // 选择小组
  selectGroup() {
    this.setData({
      showGroupModal: true
    });
  },

  // 关闭小组弹窗
  closeGroupModal() {
    this.setData({
      showGroupModal: false
    });
  },

  // 切换小组选择（多选）
  toggleGroup(e) {
    const group = e.currentTarget.dataset.group;
    let selectedGroups = [...this.data.selectedGroups];
    const index = selectedGroups.indexOf(group);
    
    if (index > -1) {
      selectedGroups.splice(index, 1);
    } else {
      selectedGroups.push(group);
    }
    
    this.setData({
      selectedGroups: selectedGroups
    });
    this.checkCanPublish();
  },

  // 确认小组选择
  confirmGroupSelection() {
    this.setData({
      showGroupModal: false
    });
    this.checkCanPublish();
  },

  // 移除已选小组
  removeGroup(e) {
    const group = e.currentTarget.dataset.group;
    let selectedGroups = [...this.data.selectedGroups];
    const index = selectedGroups.indexOf(group);
    
    if (index > -1) {
      selectedGroups.splice(index, 1);
      this.setData({
        selectedGroups: selectedGroups
      });
      this.checkCanPublish();
    }
  },

  // 检查是否可以发布
  checkCanPublish() {
    const { title, category } = this.data;
    const canPublish = title.trim() && category;
    this.setData({
      canPublish
    });
  },

  // 保存草稿
  saveDraft() {
    wx.showToast({
      title: '已保存草稿',
      icon: 'success'
    });
  },

  // 发布帖子
  publishPost() {
    if (!this.data.canPublish) {
      wx.showToast({
        title: '请填写完整信息',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({
      title: '发布中...'
    });

    // 模拟发布
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({
        title: '发布成功',
        icon: 'success'
      });
      
      // 返回上一页
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }, 2000);
  },

  // 页面加载
  onLoad() {
    // 页面加载时的初始化
  },

  // 页面显示
  onShow() {
    // 更新TabBar状态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({
        selected: 2
      });
    }
  }
});