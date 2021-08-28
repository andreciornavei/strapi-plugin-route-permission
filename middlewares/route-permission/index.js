"use strict"

const _ = require("lodash")

const injectPluginName = (route, pluginName) => {
  route['plugin'] = pluginName
  return route;
}

module.exports = strapi => {
  return {
    async initialize() {

      try {
        // Remove everything from permission with type 'application'
        await strapi.query('permission', 'users-permissions').model.where('type', 'application').destroy()
      } catch (error) { console.log("No 'application' permissions to destroy...") }

      // Build route authentication role based on route 'config.permission' attribute
      // if it does not contains 'config.permission' assume Forbidden Access
      const roles = {}
      const routes = _.get(strapi, "config.routes", []).map(route => injectPluginName(route, "application"))
      _.forEach(_.get(strapi, "plugins", []), (plugin, pluginName) => {
        const pluginRoutes = _.get(plugin, "config.routes", []).map(route => injectPluginName(route, pluginName))
        routes.push(...pluginRoutes)
      })

      _.forEach(routes, route => {
        const [controller, action] = _.get(route, "handler").split(".")
        if (_.get(route, 'config.permission')) {
          const path = `${_.get(route, 'config.permission')}.${_.get(route, "plugin")}.${controller}`
          _.set(roles, path, [...(_.get(roles, path, [])), action])
        }
      });

      // ********************************************************* //
      // Allow specific authenticated routes for users-permissions //
      // ********************************************************* //
      for (const roleType in roles) {
        const role = await strapi.query('role', 'users-permissions').findOne({ type: roleType })
        if (role) {
          // iterate plugins
          for (const plugin in roles[role.type]) {
            // re-create role for each plugin
            for (const controller in roles[role.type][plugin]) {
              for (const action of roles[role.type][plugin][controller]) {
                const payloadId = {
                  type: plugin,
                  controller: controller,
                  action: action,
                  role: role.id
                }
                const permission = await strapi.query('permission', 'users-permissions').findOne(payloadId)
                if (permission) {
                  console.log(`updating permission ::: ${role.type}.application.${controller}.${action}`)
                  await strapi.query('permission', 'users-permissions').update({ id: permission.id }, { enabled: true })
                } else {
                  console.log(`generating permission ::: ${role.type}.application.${controller}.${action}`)
                  await strapi.query('permission', 'users-permissions').create({ ...payloadId, enabled: true })
                }
              }
            }
          }
        }
      }

    },
  };
};
