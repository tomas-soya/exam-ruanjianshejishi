// Public project links. No account secrets belong here.
window.RUANKAO_PROJECT = {
  author: 'tomas-soya',
  authorUrl: 'https://github.com/tomas-soya',
  repositoryUrl: 'https://github.com/tomas-soya/exam-ruanjianshejishi'
};

document.addEventListener('DOMContentLoaded', function () {
  const info = window.RUANKAO_PROJECT;
  const author = document.getElementById('project-author');
  author.textContent = info.author;
  author.href = info.authorUrl;
  const repo = document.getElementById('project-repository');
  const issue = document.getElementById('project-issues');
  if (info.repositoryUrl) {
    const url = new URL(info.repositoryUrl);
    if (url.protocol === 'https:') {
      repo.href = url.href;
      repo.textContent = 'GitHub 仓库';
      issue.href = url.href.replace(/\/$/, '') + '/issues';
    }
  }
});
