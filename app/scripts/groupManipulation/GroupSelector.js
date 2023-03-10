import _ from 'lodash'
import $ from 'jquery'
import Alerts from '../utils/Alerts'
import ChromeStorage from '../utils/ChromeStorage'
import LanguageUtils from '../utils/LanguageUtils'
import Events from '../Events'
import HypothesisClientManager from '../annotationServer/hypothesis/HypothesisClientManager'
import Config from '../Config'
import CXLImporter from '../importExport/cmap/CXLImporter'
import Codebook from '../codebook/model/Codebook'

const GroupName = Config.groupName

class GroupSelector {
  constructor () {
    this.selectedGroupNamespace = 'groupManipulation.currentGroup'
    this.groups = null
    this.currentGroup = null
    this.user = {}
    this.events = {}
    this.groupFullName = null
    this.loginWindow = null
    this.loggedInInterval = null
  }

  init (callback) {
    console.debug('Initializing group selector')
    this.initCodebookDeletedEvent()
    this.initCodebookRenamedEvent()
    this.checkIsLoggedIn((err) => {
      if (err) {
        // Stop propagating the rest of the functions, because it is not logged in annotation server
        // Show that user need to log in remote annotation server to continue
        Alerts.errorAlert({
          title: 'Log in required',
          text: chrome.i18n.getMessage('annotationServerLoginRequired')
        })
      } else {
        // Retrieve user profile (for further uses in other functionalities of the tool)
        this.retrieveUserProfile(() => {
          // Define current group
          this.defineCurrentGroup(() => {
            this.reloadGroupsContainer()
            console.debug('Initialized group selector')
            if (_.isFunction(callback)) {
              callback(null)
            }
          })
        })
      }
    })
  }

  initCodebookDeletedEvent () {
    this.events.codebookDeletedEvent = { element: document, event: Events.codebookDeleted, handler: this.codebookDeletedEventHandler() }
    this.events.codebookDeletedEvent.element.addEventListener(this.events.codebookDeletedEvent.event, this.events.codebookDeletedEvent.handler, false)
  }

  initCodebookRenamedEvent () {
    this.events.codebookRenamedEvent = { element: document, event: Events.codebookRenamed, handler: this.codebookRenamedEventHandler() }
    this.events.codebookRenamedEvent.element.addEventListener(this.events.codebookRenamedEvent.event, this.events.codebookRenamedEvent.handler, false)
  }

  /**
   * This function defines the group of annotations that is selected by default when the application is opened
   * @param callback
   */
  defineCurrentGroup (callback) {
    // TODO Re-describe: Defines one of the possibles groups as the current group of the highlighter
    if (window.abwa.annotationBasedInitializer.initAnnotation) {
      this.defineGroupBasedOnInitAnnotation(callback)
    } else {
      this.retrieveUserProfile(() => {
        // Load all the groups belonged to current user
        this.retrieveGroups((err, groups) => {
          if (err) {
            callback(err)
          } else {
            ChromeStorage.getData(this.selectedGroupNamespace, ChromeStorage.local, (err, savedCurrentGroup) => {
              if (!err && !_.isEmpty(savedCurrentGroup) && _.has(savedCurrentGroup, 'data')) {
                // Parse saved current group
                try {
                  const savedCurrentGroupData = JSON.parse(savedCurrentGroup.data)
                  const currentGroup = _.find(this.groups, (group) => {
                    return group.id === savedCurrentGroupData.id
                  })
                  // Check if group exists in current user
                  if (_.isObject(currentGroup)) {
                    this.currentGroup = currentGroup
                  }
                } catch (e) {
                  // Nothing to do
                }
              }
              // If group cannot be retrieved from saved in extension annotationServer
              // Try to load a group with defaultName
              if (_.isEmpty(this.currentGroup)) {
                if (!_.isEmpty(window.abwa.groupSelector.groups)) {
                  this.currentGroup = _.first(window.abwa.groupSelector.groups)
                  callback(null)
                } else {
                  let options = {}
                  options.importCXLFile = () => {
                    CXLImporter.importCXLfile()
                  }

                  options.configure = () => {
                    this.createNewGroup((err, result) => {
                      if (err) {
                        Alerts.errorAlert({ text: 'Unable to create a new group. Please try again or contact developers if the error continues happening.' })
                      } else {
                        // Update list of groups from annotation Server
                        this.retrieveGroups(() => {
                          // Move group to new created one
                          this.setCurrentGroup(result.id, () => {
                            // Expand groups container
                            this.container.setAttribute('aria-expanded', 'false')
                            // Reopen sidebar if closed
                            window.abwa.sidebar.openSidebar()
                            callback(null)
                          })
                        })
                      }
                    })
                  }
                  let showForm = () => {
                    // Create form
                    let html = ''
                    Alerts.twoOptionsAlert({
                      title: 'How do you want to start concept mapping?',
                      html: html,
                      confirmButtonText: 'Import cxl file',
                      denyButtonText: 'Configurate by myself',
                      callback: options.importCXLFile,
                      denyCallback: options.configure,
                      customClass: 'large-swal',
                      allowOutsideClick: false
                    })
                  }
                  showForm()
                }
              } else { // If group was found in extension annotation server
                if (_.isFunction(callback)) {
                  callback()
                }
              }
            })
          }
        })
      })
    }
  }

  defineGroupBasedOnInitAnnotation (callback) {
    const annotationGroupId = window.abwa.annotationBasedInitializer.initAnnotation.group
    // Load group of annotation
    this.retrieveUserProfile(() => {
      this.retrieveGroups((err, groups) => {
        if (err) {
          if (_.isFunction(callback)) {
            callback(err)
          }
        } else {
          // Set current group
          this.currentGroup = _.find(groups, (group) => { return group.id === annotationGroupId })
          // Save to chrome annotation server current group
          ChromeStorage.setData(this.selectedGroupNamespace, { data: JSON.stringify(this.currentGroup) }, ChromeStorage.local)
          if (_.isFunction(callback)) {
            callback()
          }
        }
      })
    })
  }

  checkIsLoggedIn (callback) {
    const sidebarURL = chrome.extension.getURL('pages/sidebar/groupSelection.html')
    $.get(sidebarURL, (html) => {
      // Append sidebar to content
      $('#abwaSidebarContainer').append($.parseHTML(html))
      window.abwa.annotationServerManager.isLoggedIn((err, result) => {
        if (err || !result) {
          // Display login/sign up form
          $('#notLoggedInGroupContainer').attr('aria-hidden', 'false')
          // Hide group container
          $('#loggedInGroupContainer').attr('aria-hidden', 'true')
          // Hide purposes wrapper
          $('#purposesWrapper').attr('aria-hidden', 'true')
          // Open the sidebar to notify user that needs to log in
          window.abwa.sidebar.openSidebar()
          document.getElementById('hypothesisLoginButton').addEventListener('click', () => {
            chrome.runtime.sendMessage({ scope: 'hypothesis', cmd: 'userLoginForm' }, () => {
              if (result.error) {
                if (_.isFunction(callback)) {
                  callback(new Error(result.error))
                }
              } else {
                console.debug('Logged in. Reloading...')
                window.location.reload()
              }
            })
          })
          if (LanguageUtils.isInstanceOf(window.abwa.annotationServerManager, HypothesisClientManager)) {
            // Show login form for Hypothes.is in sidebar
            $('#hypothesisLoginContainer').attr('aria-hidden', 'false')
          }
          if (_.isFunction(callback)) {
            callback(new Error('Is not logged in'))
          }
        } else {
          if (_.isFunction(callback)) {
            callback()
          }
        }
      })
    })
  }

  createApplicationBasedGroupForUser (callback) {
    window.abwa.annotationServerManager.client.createNewGroup({ name: Config.groupName }, callback)
  }

  reloadGroupsContainer (callback) {
    this.retrieveGroups(() => {
      this.container = document.querySelector('#groupSelector')
      this.container.setAttribute('aria-expanded', 'false')
      this.renderGroupsContainer()
      if (_.isFunction(callback)) {
        callback()
      }
    })
  }

  renderGroupsContainer () {
    // Current group element rendering
    const currentGroupNameElement = document.querySelector('#groupSelectorName')
    if (this.currentGroup) {
      currentGroupNameElement.innerText = this.currentGroup.name
      currentGroupNameElement.title = this.currentGroup.name
    }
    // Toggle functionality
    const toggleElement = document.querySelector('#groupSelectorToggle')
    if (this.groupSelectorToggleClickEvent) {
      currentGroupNameElement.removeEventListener('click', this.groupSelectorToggleClickEvent)
      toggleElement.removeEventListener('click', this.groupSelectorToggleClickEvent)
    }
    this.groupSelectorToggleClickEvent = this.createGroupSelectorToggleEvent()
    currentGroupNameElement.addEventListener('click', this.groupSelectorToggleClickEvent)
    toggleElement.addEventListener('click', this.groupSelectorToggleClickEvent)
    // Groups container
    const groupsContainer = document.querySelector('#groupSelectorContainerSelector')
    groupsContainer.innerText = ''
    // For each group
    const groupSelectorItemTemplate = document.querySelector('#groupSelectorItem')
    for (let i = 0; i < this.groups.length; i++) {
      const group = this.groups[i]
      const groupSelectorItem = $(groupSelectorItemTemplate.content.firstElementChild).clone().get(0)
      // Container
      groupsContainer.appendChild(groupSelectorItem)
      groupSelectorItem.id = 'groupSelectorItemContainer_' + group.id
      // Name
      const nameElement = groupSelectorItem.querySelector('.groupSelectorItemName')
      nameElement.innerText = group.name
      nameElement.title = 'Move to annotation group ' + group.name
      nameElement.addEventListener('click', this.createGroupChangeEventHandler(group.id))
      // Toggle
      groupSelectorItem.querySelector('.groupSelectorItemToggle').addEventListener('click', this.createGroupSelectorItemToggleEventHandler(group.id))
      // Options
      groupSelectorItem.querySelector('.renameGroup').addEventListener('click', this.createGroupSelectorRenameOptionEventHandler(group))
      groupSelectorItem.querySelector('.deleteGroup').addEventListener('click', this.createGroupSelectorDeleteOptionEventHandler(group))
    }
    // New group button
    const newGroupButton = document.createElement('div')
    newGroupButton.innerText = 'Create ' + Config.codebook
    newGroupButton.id = 'createNewModelButton'
    newGroupButton.className = 'groupSelectorButton'
    newGroupButton.title = 'Create a new codebook'
    newGroupButton.addEventListener('click', this.createNewReviewModelEventHandler())
    groupsContainer.appendChild(newGroupButton)
  }

  createGroupSelectorToggleEvent () {
    return (e) => {
      this.toggleGroupSelectorContainer()
    }
  }

  toggleGroupSelectorContainer () {
    const groupSelector = document.querySelector('#groupSelector')
    if (groupSelector.getAttribute('aria-expanded') === 'true') {
      groupSelector.setAttribute('aria-expanded', 'false')
    } else {
      groupSelector.setAttribute('aria-expanded', 'true')
    }
  }

  createGroupChangeEventHandler (groupId) {
    return (e) => {
      this.setCurrentGroup(groupId)
    }
  }

  updateCurrentGroupHandler (groupId) {
    this.currentGroup = _.find(this.groups, (group) => { return groupId === group.id })
    ChromeStorage.setData(this.selectedGroupNamespace, { data: JSON.stringify(this.currentGroup) }, ChromeStorage.local, () => {
      console.debug('Group updated. Name: %s id: %s', this.currentGroup.name, this.currentGroup.id)
      // Dispatch event
      LanguageUtils.dispatchCustomEvent(Events.groupChanged, {
        group: this.currentGroup,
        time: new Date()
      })
    })
  }

  setCurrentGroup (groupId, callback) {
    // Set current group
    const newCurrentGroup = _.find(this.groups, (group) => { return group.id === groupId })
    if (newCurrentGroup) {
      this.currentGroup = newCurrentGroup
    }
    // Render groups container
    this.reloadGroupsContainer((err) => {
      if (err) {
        if (_.isFunction(callback)) {
          callback(err)
        }
      } else {
        // Event group changed
        this.updateCurrentGroupHandler(this.currentGroup.id)
        // Open sidebar
        window.abwa.sidebar.openSidebar()
        if (_.isFunction(callback)) {
          callback()
        }
      }
    })
  }

  createGroupSelectorItemToggleEventHandler (groupId) {
    return (e) => {
      const groupSelectorItemContainer = document.querySelector('#groupSelectorContainerSelector').querySelector('#groupSelectorItemContainer_' + groupId)
      if (groupSelectorItemContainer.getAttribute('aria-expanded') === 'true') {
        groupSelectorItemContainer.setAttribute('aria-expanded', 'false')
      } else {
        groupSelectorItemContainer.setAttribute('aria-expanded', 'true')
      }
    }
  }

  createNewReviewModelEventHandler () {
    return () => {
      this.createNewGroup((err, result) => {
        if (err) {
          Alerts.errorAlert({ text: 'Unable to create a new group. Please try again or contact developers if the error continues happening.' })
        } else {
          // Update list of groups from annotation Server
          this.retrieveGroups(() => {
            // Move group to new created one
            this.setCurrentGroup(result.id, () => {
              // Expand groups container
              this.container.setAttribute('aria-expanded', 'false')
              // Reopen sidebar if closed
              window.abwa.sidebar.openSidebar()
            })
          })
        }
      })
    }
  }

  createNewGroup (loadingCallback) {
    let title = 'What is the topic or the focus question?'
    let inputPlaceholder = 'What is the topic or the focus question?'
    Alerts.inputTextAlert({
      title: title,
      allowOutsideClick: false,
      inputPlaceholder: inputPlaceholder,
      showCancelButton: false,
      preConfirm: (groupName) => {
        if (_.isString(groupName)) {
          if (groupName.length <= 0) {
            const swal = require('sweetalert2').default
            swal.showValidationMessage('Name cannot be empty.')
          } else if (groupName.length > 25) {
            console.log(groupName)
            this.groupFullName = groupName
            groupName = groupName.substring(0, 24)
            console.log(groupName)
            return groupName
          } else {
            this.groupFullName = groupName
            return groupName
          }
        }
      },
      callback: (err, groupName) => {
        if (err) {
          window.alert('Unable to load swal. Please contact developer.')
        } else {
          groupName = LanguageUtils.normalizeString(groupName)
          window.abwa.annotationServerManager.client.createNewGroup({ name: groupName, description: 'A group created using annotation tool ' + chrome.runtime.getManifest().name }, (err, newGroup) => {
            if (err) {
              window.alert('Unable to load swal. Please contact developer.')
            } else {
              Alerts.inputTextAlert({
                title: 'Introduce the meta-concepts. Separate each meta-concept with a ;',
                allowOutsideClick: false,
                inputPlaceholder: 'meta-concept1;meta-concept2...',
                showCancelButton: false,
                preConfirm: (dimensionString) => {
                  if (_.isString(dimensionString)) {
                    let dimensionsList = dimensionString.split(';')
                    dimensionsList.forEach(element => console.log(element.trim))
                    if (dimensionsList.length <= 0) {
                      const swal = require('sweetalert2').default
                      swal.showValidationMessage('Meta-concepts not found.')
                    } else {
                      return dimensionsList
                    }
                  }

                },
                callback: (err, dimensionsList) => {
                  if (err) {
                    window.alert('Unable to load swal. Please contact developer.')
                  } else {
                    groupName = LanguageUtils.normalizeString(groupName)
                    let tempCodebook = Codebook.fromCXLFile(null, dimensionsList, groupName, groupName, [])
                    window.abwa.groupSelector.groups.push(newGroup)
                    Codebook.setAnnotationServer(newGroup.id, (annotationServer) => {
                      tempCodebook.annotationServer = annotationServer
                      let topicThemeObject
                      topicThemeObject = _.filter(tempCodebook.themes, (theme) => {
                        return theme.topic === groupName || theme.name === groupName
                      })
                      topicThemeObject[0].isTopic = true
                      let annotations = tempCodebook.toAnnotations()
                      // Send create highlighter
                      window.abwa.annotationServerManager.client.createNewAnnotations(annotations, (err, codebookAnnotations) => {
                        if (err) {
                          Alerts.errorAlert({ text: 'Unable to create new group.' })
                        } else {
                          loadingCallback(null, newGroup)
                        }
                      })
                    })
                  }
                  // window.abwa.annotationServerManager.client.createNewGroup({ name: groupName, description: 'A group created using annotation tool ' + chrome.runtime.getManifest().name }, () => {
                  // })
                  // loadingCallback()
                }
              })
            }
            // loadingCallback()
          })
        }
      }
    })
  }

  createGroupSelectorDeleteOptionEventHandler (group) {
    return (event) => {
      LanguageUtils.dispatchCustomEvent(Events.deleteCodebook, { codebook: group, user: this.user })
    }
  }

  codebookDeletedEventHandler () {
    return (event) => {
      if (event.detail.err) {
        Alerts.errorAlert({ text: 'Error when deleting the group: ' + event.detail.err.message })
      } else {
        // If removed group is the current group, current group must defined again
        if (event.detail.group.id === this.currentGroup.id) {
          this.currentGroup = null
        }
        // Move to first other group if exists
        this.defineCurrentGroup(() => {
          this.reloadGroupsContainer(() => {
            // Dispatch group has changed
            this.updateCurrentGroupHandler(this.currentGroup.id)
            // Expand groups container
            this.container.setAttribute('aria-expanded', 'false')
            // Reopen sidebar if closed
            window.abwa.sidebar.openSidebar()
          })
        })
      }
    }
  }

  createGroupSelectorRenameOptionEventHandler (group) {
    return () => {
      LanguageUtils.dispatchCustomEvent(Events.renameCodebook, { codebook: group })
    }
  }

  codebookRenamedEventHandler () {
    return (event) => {
      if (event.detail.err) {
        Alerts.errorAlert({ text: 'Error when renaming the group: ' + event.detail.err.message })
      } else {
        this.currentGroup = event.detail.group
        this.retrieveGroups(() => {
          this.reloadGroupsContainer(() => {
            this.container.setAttribute('aria-expanded', 'true')
            window.abwa.sidebar.openSidebar()
          })
        })
      }
    }
  }

  retrieveGroups (callback) {
    window.abwa.annotationServerManager.client.getListOfGroups({}, (err, groups) => {
      if (err) {
        if (_.isFunction(callback)) {
          callback(err)
        }
      } else {
        this.groups = groups
        // Remove public group in hypothes.is and modify group URL
        if (LanguageUtils.isInstanceOf(window.abwa.annotationServerManager, HypothesisClientManager)) {
          _.remove(this.groups, (group) => {
            return group.id === '__world__'
          })
          _.forEach(this.groups, (group) => {
            if (_.has(group, 'links.html')) {
              group.links.html = group.links.html.substr(0, group.links.html.lastIndexOf('/'))
            }
          })
        }
        if (_.isFunction(callback)) {
          callback(null, groups)
        }
      }
    })
  }

  retrieveUserProfile (callback) {
    window.abwa.annotationServerManager.client.getUserProfile((err, profile) => {
      if (err) {
        if (_.isFunction(callback)) {
          callback(err)
        }
      } else {
        this.user = profile
        if (_.isFunction(callback)) {
          callback(null, profile.groups)
        }
      }
    })
  }

  getCreatorData () {
    if (this.user) {
      // TODO Re-enable orcid mechanism to identify
      return window.abwa.annotationServerManager.annotationServerMetadata.userUrl + this.user.userid.replace('acct:', '').replace('@hypothes.is', '')
    } else {
      return null
    }
  }

  destroy (callback) {
    // Destroy intervals
    if (this.loggedInInterval) {
      clearInterval(this.loggedInInterval)
    }
    if (_.isFunction(callback)) {
      callback()
    }
  }
}

export default GroupSelector
