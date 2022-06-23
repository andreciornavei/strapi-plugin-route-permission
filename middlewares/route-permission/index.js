"use strict"

const _ = require("lodash")

const injectPluginName = (route, pluginName) => {
  route['plugin'] = pluginName
  return route;
}

module.exports = strapi => {

  return {
    beforeInitialize() {
      if (!strapi.config.middleware.load.after.includes("route-permission")) {
        strapi.config.middleware.load.after.push("route-permission")
      }
    },
    async initialize() {

      // define roles on the first to be reusable
      // by script and functions
      const roles = {}

      // define the permissions who will
      // be enabled by default if it nos
      // specified on routes
      const DEFAULT_ENABLED_PERMISSIONS = [
        // "public.users-permissions.auth.callback",
        // "public.users-permissions.auth.connect",
        // "public.users-permissions.auth.emailconfirmation",
        // "public.users-permissions.auth.forgotpassword",
        // "public.users-permissions.auth.forgotpassword",
        // "public.users-permissions.auth.register",
        // "public.users-permissions.auth.resetpassword",
        // "public.users-permissions.auth.sendemailconfirmation",
        // "authenticated.users-permissions.user.me",
      ]

      const configureRole = async (target_role) => {
        // check if role already was registered on 'roles' variable
        if (Object.keys(roles).includes(target_role)) return
        // check if role exists on database
        const role = await strapi.query('role', 'users-permissions').findOne({ type: target_role })
        // create the role if it does not exists
        if (!role) {
          console.log("generating new role::", target_role)
          await strapi.query("role", "users-permissions").create({
            name: target_role.charAt(0).toUpperCase() + target_role.slice(1),
            description: `Default role given to ${target_role} user.`,
            type: target_role
          })
        }
      }

      const manageRole = async (type, plugin, controller, action) => {
        const path = `${type}.${plugin}.${controller}`
        _.set(roles, path, [...(_.get(roles, path, [])), String(action).toLowerCase()])
      }


      try {
        // Update all permissions to enabled = false
        await strapi.query('permission', 'users-permissions').model
          .where("id", "!=", 0)
          .save({ enabled: 0 }, { method: "update", patch: true })
      } catch (error) { console.log("No permissions to update...") }

      try {
        // Update specified default permissions enabled = true
        for (const permission of DEFAULT_ENABLED_PERMISSIONS) {
          const [type, plugin, controller, action] = permission.split(".")
          await configureRole(type)
          await manageRole(type, plugin, controller, action)
        }
      } catch (error) { console.log("No default enabled permissions to update") }


      // Build route authentication role based on route 'config.permission' attribute
      // if it does not contains 'config.permission' assume Forbidden Access
      const routes = _.get(strapi, "config.routes", []).map(route => injectPluginName(route, "application"))
      _.forEach(_.get(strapi, "plugins", []), (plugin, pluginName) => {
        const pluginRoutes = _.get(plugin, "config.routes", []).map(route => injectPluginName(route, pluginName))
        routes.push(...pluginRoutes)
      })

      for (const route of routes) {
        const [controller, action] = _.get(route, "handler").split(".")
        if (_.get(route, 'config.roles') || _.get(route, 'config.permission')) {
          // treat for permission target to multi or single roles
          let target_roles = []
          const config_roles = _.get(route, "config.roles", _.get(route, 'config.permission'))
          if (_.isString(config_roles)) target_roles = [config_roles.toLowerCase()]
          else if (_.isArray(config_roles)) target_roles = config_roles.map(i => i.toLowerCase())
          // attatch permission to target roles
          for (const target_role of target_roles) {
            // configure role
            await configureRole(target_role)
            // create path for controller permission and attach to roles
            await manageRole(target_role, _.get(route, "plugin"), controller, action)
          }
        }
      }

      // ********************************************************* //
      // Allow specific authenticated routes for users-permissions //
      // ********************************************************* //
      for (const roleType in roles) {
        const role = await strapi.query('role', 'users-permissions').findOne({ type: roleType })
        if (role) {
          // iterate plugins
          for (const plugin in roles[role.type]) {
            // re-create role for each plugin

            // bursting system
            let burst = [];
            const burstSize = 10;

            // Create / Update Logic
            for (const controller in roles[role.type][plugin]) {
              for (const action of roles[role.type][plugin][controller]) {
                const controllerLowerCase = String(controller).toLowerCase()
                const actionLowerCase = String(action).toLowerCase()
                const payloadId = {
                  type: plugin,
                  controller: controllerLowerCase,
                  action: actionLowerCase,
                  role: role.id
                }

                const permission = await strapi.query('permission', 'users-permissions').findOne(payloadId)
                if (permission) {

                  // await strapi.query('permission', 'users-permissions').update({ id: permission.id }, { enabled: true })
                  // console.log(`updating permission ::: ${role.type}.${plugin}.${controllerLowerCase}.${actionLowerCase} ::: ID=${permission.id}`)

                  const promise = strapi.query('permission', 'users-permissions').update({ id: permission.id }, { enabled: true })
                    .then(cId => console.log(`updating permission ::: ${role.type}.${plugin}.${controllerLowerCase}.${actionLowerCase} ::: ID=${cId.id}`));
                  burst.push(promise);
                } else {

                  // const pId = await strapi.query('permission', 'users-permissions').create({ ...payloadId, enabled: true })
                  // console.log(`generating permission ::: ${role.type}.${plugin}.${controllerLowerCase}.${actionLowerCase} ::: ID=${pId.id}`)

                  const promise = strapi.query('permission', 'users-permissions').create({ ...payloadId, enabled: true })
                    .then(pId => console.log(`generating permission ::: ${role.type}.${plugin}.${controllerLowerCase}.${actionLowerCase} ::: ID=${pId.id}`))
                  burst.push(promise);
                }

                // Burst Control
                if (burst.length >= burstSize) {
                  await Promise.all(burst);
                  burst = []
                }
              }
            }
          }
        }
      }
    },
  };
};
